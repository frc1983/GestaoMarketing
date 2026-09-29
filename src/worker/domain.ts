import { Hono } from 'hono';
import { z } from 'zod';
import { parseCsv, roiBalance, roiPercent, sumCents } from '../shared/logic';
import { ROI_EXPENSE_CATEGORIES } from '../shared/types';
import { getRecord, toRecord, touchRecordStatements, type RecordRow } from './db';
import type { Env } from './env';

type Bindings = { Bindings: Env; Variables: { csrfToken: string } };
export const domainApi = new Hono<Bindings>();

async function stockRows(db: D1Database, itemId?: string) {
  const query = itemId
    ? db.prepare(`SELECT v.id, v.item_id, v.name, v.minimum,
      COALESCE((SELECT SUM(m.quantity) FROM stock_movements m WHERE m.variant_id=v.id),0) AS on_hand,
      COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r WHERE r.variant_id=v.id AND r.status='active'),0) AS reserved
      FROM stock_variants v WHERE v.item_id=? ORDER BY v.name`).bind(itemId)
    : db.prepare(`SELECT v.id, v.item_id, v.name, v.minimum,
      COALESCE((SELECT SUM(m.quantity) FROM stock_movements m WHERE m.variant_id=v.id),0) AS on_hand,
      COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r WHERE r.variant_id=v.id AND r.status='active'),0) AS reserved
      FROM stock_variants v ORDER BY v.item_id, v.name`);
  const rows = await query.all<{ id: string; item_id: string; name: string; minimum: number; on_hand: number; reserved: number }>();
  return rows.results.map(v => ({ id: v.id, itemId: v.item_id, name: v.name, minimum: v.minimum,
    onHand: v.on_hand, reserved: v.reserved, available: v.on_hand - v.reserved }));
}

domainApi.get('/stock/items', async c => {
  const items = await c.env.DB.prepare("SELECT * FROM records WHERE kind='stock_item' AND archived_at IS NULL ORDER BY title").all<RecordRow>();
  const variants = await stockRows(c.env.DB);
  const photos = await c.env.DB.prepare('SELECT item_id,id FROM image_assets ORDER BY created_at').all<{ item_id: string; id: string }>();
  return c.json({ data: items.results.map(row => ({ ...toRecord(row), variants: variants.filter(v => v.itemId === row.id),
    imageUrl: photos.results.find(photo => photo.item_id === row.id) ? `/api/images/${photos.results.find(photo => photo.item_id === row.id)?.id}` : null })) });
});
domainApi.get('/stock/items/:id/variants', async c => c.json({ data: await stockRows(c.env.DB, c.req.param('id')) }));
domainApi.post('/stock/items/:id/variants', async c => {
  const item = await getRecord(c.env.DB, 'stock_item', c.req.param('id'));
  if (!item) return c.json({ error: 'Item não encontrado' }, 404);
  const parsed = z.object({ name: z.string().trim().min(1), minimum: z.number().int().min(0).default(0) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Variante inválida' }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.batch([c.env.DB.prepare('INSERT INTO stock_variants (id, item_id, name, minimum) VALUES (?, ?, ?, ?)')
    .bind(id, item.id, parsed.data.name, parsed.data.minimum), ...touchRecordStatements(c.env.DB, item)]);
  return c.json({ data: { id, itemId: item.id, ...parsed.data } }, 201);
});

const stockAction = z.object({ itemId: z.string().uuid(), variantId: z.string().uuid(), quantity: z.number().int().refine(n => n !== 0),
  reason: z.string().trim().min(1), requester: z.string().nullish(), eventId: z.string().nullish(), client: z.string().nullish() });
domainApi.post('/stock/movements', async c => {
  const parsed = stockAction.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Movimentação inválida' }, 400);
  const body = parsed.data;
  const variant = (await stockRows(c.env.DB, body.itemId)).find(v => v.id === body.variantId);
  if (!variant) return c.json({ error: 'Variante não encontrada' }, 404);
  if (body.quantity < 0 && variant.available + body.quantity < 0) return c.json({ error: 'Estoque disponível insuficiente' }, 409);
  const id = crypto.randomUUID();
  const item = await getRecord(c.env.DB, 'stock_item', body.itemId);
  if (!item) return c.json({ error: 'Item não encontrado' }, 404);
  await c.env.DB.batch([c.env.DB.prepare(`INSERT INTO stock_movements (id, item_id, variant_id, quantity, reason, requester, event_id, client, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, body.itemId, body.variantId, body.quantity, body.reason,
      body.requester ?? null, body.eventId ?? null, body.client ?? null, new Date().toISOString()), ...touchRecordStatements(c.env.DB, item)]);
  return c.json({ data: { id, ...body } }, 201);
});
domainApi.get('/stock/movements', async c => {
  const itemId = c.req.query('itemId');
  const result = itemId
    ? await c.env.DB.prepare('SELECT * FROM stock_movements WHERE item_id=? ORDER BY created_at DESC LIMIT 200').bind(itemId).all()
    : await c.env.DB.prepare('SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT 200').all();
  return c.json({ data: result.results });
});
domainApi.post('/stock/reservations', async c => {
  const parsed = stockAction.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || parsed.data.quantity <= 0) return c.json({ error: 'Reserva inválida' }, 400);
  const body = parsed.data;
  const variant = (await stockRows(c.env.DB, body.itemId)).find(v => v.id === body.variantId);
  if (!variant) return c.json({ error: 'Variante não encontrada' }, 404);
  if (variant.available < body.quantity) return c.json({ error: 'Estoque disponível insuficiente' }, 409);
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  const item = await getRecord(c.env.DB, 'stock_item', body.itemId);
  if (!item) return c.json({ error: 'Item não encontrado' }, 404);
  await c.env.DB.batch([c.env.DB.prepare(`INSERT INTO stock_reservations
    (id, item_id, variant_id, quantity, reason, requester, event_id, client, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`).bind(id, body.itemId, body.variantId, body.quantity,
      body.reason, body.requester ?? null, body.eventId ?? null, body.client ?? null, now, now), ...touchRecordStatements(c.env.DB, item)]);
  return c.json({ data: { id, ...body, status: 'active' } }, 201);
});
domainApi.get('/stock/reservations', async c => {
  const itemId = c.req.query('itemId');
  const result = itemId
    ? await c.env.DB.prepare('SELECT * FROM stock_reservations WHERE item_id=? ORDER BY created_at DESC').bind(itemId).all()
    : await c.env.DB.prepare('SELECT * FROM stock_reservations ORDER BY created_at DESC LIMIT 200').all();
  return c.json({ data: result.results });
});
domainApi.patch('/stock/reservations/:id', async c => {
  const body = await c.req.json().catch(() => null) as { status?: string } | null;
  if (!body || !['cancelled', 'fulfilled'].includes(body.status ?? '')) return c.json({ error: 'Status inválido' }, 400);
  const reservation = await c.env.DB.prepare("SELECT * FROM stock_reservations WHERE id=? AND status='active'")
    .bind(c.req.param('id')).first<{ id: string; item_id: string; variant_id: string; quantity: number; event_id: string | null; requester: string | null; client: string | null }>();
  if (!reservation) return c.json({ error: 'Reserva ativa não encontrada' }, 404);
  const now = new Date().toISOString();
  const item = await getRecord(c.env.DB, 'stock_item', reservation.item_id);
  if (!item) return c.json({ error: 'Item não encontrado' }, 404);
  const statements = [c.env.DB.prepare('UPDATE stock_reservations SET status=?, updated_at=? WHERE id=? AND status=\'active\'')
    .bind(body.status, now, reservation.id)];
  if (body.status === 'fulfilled') statements.push(c.env.DB.prepare(`INSERT INTO stock_movements
    (id, item_id, variant_id, reservation_id, quantity, reason, requester, event_id, client, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM stock_reservations WHERE id=? AND status='fulfilled'`)
    .bind(crypto.randomUUID(), reservation.item_id, reservation.variant_id, reservation.id, -reservation.quantity, 'Consumo de reserva',
      reservation.requester, reservation.event_id, reservation.client, now, reservation.id));
  const outcomes = await c.env.DB.batch([...statements, ...touchRecordStatements(c.env.DB, item)]);
  if (outcomes[0].meta.changes !== 1) return c.json({ error: 'Reserva já encerrada' }, 409);
  return c.json({ data: { id: reservation.id, status: body.status } });
});

type RoiLedgerRow = {
  id: string;
  entry_type: 'debit' | 'credit';
  allocation: string | null;
  expense_category: string | null;
  company: string | null;
  service: string | null;
  client: string | null;
  amount_cents: number;
  occurred_on: string;
  notes: string | null;
  created_at: string;
};

const roiLedgerInput = z.discriminatedUnion('entryType', [
  z.object({ entryType: z.literal('debit'), allocation: z.enum(['Equipe Netfive', 'Cliente X', 'Cliente Y']), expenseCategory: z.enum(ROI_EXPENSE_CATEGORIES), company: z.string().trim().min(1).max(200), amountCents: z.number().int().min(0), occurredOn: z.string().date(), notes: z.string().trim().max(1000).nullish() }),
  z.object({ entryType: z.literal('credit'), service: z.string().trim().min(1).max(200), client: z.string().trim().min(1).max(200), amountCents: z.number().int().min(0), occurredOn: z.string().date(), notes: z.string().trim().max(1000).nullish() }),
]);

domainApi.get('/roi/ledger', async c => {
  const rows = await c.env.DB.prepare(`SELECT id,entry_type,allocation,expense_category,company,service,client,amount_cents,occurred_on,notes,created_at
    FROM roi_ledger_entries WHERE archived_at IS NULL ORDER BY occurred_on DESC, created_at DESC LIMIT 500`).all<RoiLedgerRow>();
  const entries = rows.results;
  const credits = sumCents(entries.filter(entry => entry.entry_type === 'credit').map(entry => entry.amount_cents));
  const debits = sumCents(entries.filter(entry => entry.entry_type === 'debit').map(entry => entry.amount_cents));
  return c.json({ data: { entries, totals: { credits, debits, balance: roiBalance(credits, debits) } } });
});

domainApi.post('/roi/ledger', async c => {
  const parsed = roiLedgerInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Lançamento de ROI inválido', details: parsed.error.flatten() }, 400);
  const entry = parsed.data; const id = crypto.randomUUID(); const now = new Date().toISOString();
  const statement = entry.entryType === 'debit'
    ? c.env.DB.prepare(`INSERT INTO roi_ledger_entries (id,entry_type,allocation,expense_category,company,amount_cents,occurred_on,notes,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id, 'debit', entry.allocation, entry.expenseCategory, entry.company, entry.amountCents, entry.occurredOn, entry.notes ?? null, now, now)
    : c.env.DB.prepare(`INSERT INTO roi_ledger_entries (id,entry_type,service,client,amount_cents,occurred_on,notes,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind(id, 'credit', entry.service, entry.client, entry.amountCents, entry.occurredOn, entry.notes ?? null, now, now);
  await statement.run();
  return c.json({ data: { id, ...entry, createdAt: now } }, 201);
});

domainApi.delete('/roi/ledger/:id', async c => {
  const result = await c.env.DB.prepare('UPDATE roi_ledger_entries SET archived_at=?, updated_at=? WHERE id=? AND archived_at IS NULL')
    .bind(new Date().toISOString(), new Date().toISOString(), c.req.param('id')).run();
  return result.meta.changes ? c.json({ data: { archived: true } }) : c.json({ error: 'Lançamento não encontrado' }, 404);
});

domainApi.get('/roi/summary', async c => {
  const events = await c.env.DB.prepare("SELECT * FROM records WHERE kind='event' AND archived_at IS NULL ORDER BY event_at DESC").all<RecordRow>();
  const result = [];
  for (const row of events.results) {
    const event = toRecord(row);
    const opportunities = await c.env.DB.prepare('SELECT * FROM roi_opportunities WHERE event_id=?').bind(event.id).all<{ amount_cents: number; stage: string }>();
    const investmentCents = Math.round(Number(event.data.actualBudget ?? 0) * 100);
    const revenueCents = opportunities.results.filter(o => o.stage === 'Fechada').reduce((n, o) => n + o.amount_cents, 0);
    const pipelineCents = opportunities.results.filter(o => !['Fechada', 'Perdida'].includes(o.stage)).reduce((n, o) => n + o.amount_cents, 0);
    const milestones = await c.env.DB.prepare('SELECT * FROM roi_milestones WHERE event_id=?').bind(event.id).all();
    const group = event.eventAt && event.eventAt.slice(0, 10) > new Date().toISOString().slice(0,10)
      ? 'Futuro' : milestones.results.length && milestones.results.every(m => (m as { status?: string }).status === 'Concluído')
        ? 'Finalizado' : 'Em mensuração';
    result.push({ eventId: event.id, eventTitle: event.title, group, investmentCents, revenueCents, pipelineCents,
      opportunityCount: opportunities.results.length, roiPercent: roiPercent(revenueCents, investmentCents), milestones: milestones.results });
  }
  return c.json({ data: result });
});
domainApi.get('/roi/opportunities', async c => {
  const eventId = c.req.query('eventId');
  const result = eventId
    ? await c.env.DB.prepare('SELECT * FROM roi_opportunities WHERE event_id=? ORDER BY updated_at DESC').bind(eventId).all()
    : await c.env.DB.prepare('SELECT * FROM roi_opportunities ORDER BY updated_at DESC LIMIT 200').all();
  return c.json({ data: result.results });
});
const opportunityInput = z.object({ eventId: z.string().uuid(), externalId: z.string().nullish(), account: z.string().trim().min(1),
  amountCents: z.number().int().min(0), stage: z.string().trim().min(1), closeDate: z.string().nullish(), owner: z.string().nullish() });
domainApi.post('/roi/opportunities', async c => {
  const parsed = opportunityInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Oportunidade inválida' }, 400);
  if (!await getRecord(c.env.DB, 'event', parsed.data.eventId)) return c.json({ error: 'Evento não encontrado' }, 404);
  const o = parsed.data; const id = crypto.randomUUID();
  const event = await getRecord(c.env.DB, 'event', o.eventId);
  if (!event) return c.json({ error: 'Evento não encontrado' }, 404);
  await c.env.DB.batch([c.env.DB.prepare(`INSERT INTO roi_opportunities (id,event_id,external_id,account,amount_cents,stage,close_date,owner,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).bind(id, o.eventId, o.externalId ?? null, o.account, o.amountCents, o.stage,
      o.closeDate ?? null, o.owner ?? null, new Date().toISOString()), ...touchRecordStatements(c.env.DB, event)]);
  return c.json({ data: { id, ...o } }, 201);
});
domainApi.patch('/roi/opportunities/:id', async c => {
  const current = await c.env.DB.prepare('SELECT * FROM roi_opportunities WHERE id=?').bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!current) return c.json({ error: 'Oportunidade não encontrada' }, 404);
  const raw = await c.req.json().catch(() => null);
  const parsed = opportunityInput.safeParse({ eventId: current.event_id, externalId: current.external_id, account: current.account,
    amountCents: current.amount_cents, stage: current.stage, closeDate: current.close_date, owner: current.owner, ...raw });
  if (!parsed.success) return c.json({ error: 'Oportunidade inválida' }, 400);
  const o = parsed.data;
  const event = await getRecord(c.env.DB, 'event', o.eventId);
  if (!event) return c.json({ error: 'Evento não encontrado' }, 404);
  await c.env.DB.batch([c.env.DB.prepare(`UPDATE roi_opportunities SET external_id=?,account=?,amount_cents=?,stage=?,close_date=?,owner=?,updated_at=? WHERE id=?`)
    .bind(o.externalId ?? null, o.account, o.amountCents, o.stage, o.closeDate ?? null, o.owner ?? null, new Date().toISOString(), c.req.param('id')),
    ...touchRecordStatements(c.env.DB, event)]);
  return c.json({ data: { id: c.req.param('id'), ...o } });
});

domainApi.get('/results', async c => {
  const tasks = await c.env.DB.prepare("SELECT status, due_at, data_json FROM records WHERE kind='task' AND archived_at IS NULL").all<{ status: string; due_at: string | null; data_json: string }>();
  const completed = tasks.results.filter(t => t.status === 'Concluído');
  const onTime = completed.filter(t => { const completedAt = (JSON.parse(t.data_json) as { completedAt?: string }).completedAt; return t.due_at && completedAt && completedAt.slice(0,10) <= t.due_at.slice(0,10); });
  const events = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM records WHERE kind='event' AND status IN ('Realizado','Em acompanhamento','Finalizado') AND archived_at IS NULL").first<{ count: number }>();
  return c.json({ data: { tasksCompleted: completed.length, onTimePercent: completed.filter(t => t.due_at).length ? Math.round(onTime.length / completed.filter(t => t.due_at).length * 100) : null, eventsWorked: events?.count ?? 0 } });
});
domainApi.get('/agency', async c => {
  const tasks = await c.env.DB.prepare("SELECT * FROM records WHERE kind='task' AND agency_status IS NOT NULL AND archived_at IS NULL ORDER BY updated_at DESC").all<RecordRow>();
  return c.json({ data: tasks.results.map(toRecord) });
});

domainApi.get('/dashboard', async c => {
  const counts = await c.env.DB.prepare("SELECT kind, status, COUNT(*) AS count FROM records WHERE archived_at IS NULL GROUP BY kind, status").all<{ kind: string; status: string; count: number }>();
  const statusCounts: Record<string, Record<string, number>> = {};
  const plural: Record<string, string> = { task: 'tasks', project: 'projects', event: 'events', roi: 'roi', stock_item: 'stock' };
  for (const entry of counts.results) (statusCounts[plural[entry.kind] ?? entry.kind] ??= {})[entry.status] = entry.count;
  const agency = await c.env.DB.prepare("SELECT agency_status AS status, COUNT(*) AS count FROM records WHERE agency_status IS NOT NULL AND archived_at IS NULL GROUP BY agency_status").all<{ status: string; count: number }>();
  statusCounts.agency = Object.fromEntries(agency.results.map(v => [v.status, v.count]));
  const allEvents = await c.env.DB.prepare("SELECT id,event_at FROM records WHERE kind='event' AND archived_at IS NULL").all<{ id: string; event_at: string | null }>();
  statusCounts.roi = { Futuro: 0, 'Em mensuração': 0, Finalizado: 0 };
  for (const event of allEvents.results) {
    if (event.event_at && event.event_at.slice(0,10) > new Date().toISOString().slice(0,10)) statusCounts.roi.Futuro++;
    else {
      const milestones = await c.env.DB.prepare('SELECT status FROM roi_milestones WHERE event_id=?').bind(event.id).all<{ status: string }>();
      if (milestones.results.length && milestones.results.every(m => m.status === 'Concluído')) statusCounts.roi.Finalizado++;
      else statusCounts.roi['Em mensuração']++;
    }
  }
  const tasks = await c.env.DB.prepare("SELECT * FROM records WHERE kind='task' AND archived_at IS NULL AND status != 'Concluído' AND due_at IS NOT NULL ORDER BY due_at LIMIT 8").all<RecordRow>();
  const events = await c.env.DB.prepare("SELECT * FROM records WHERE kind='event' AND archived_at IS NULL AND event_at IS NOT NULL AND event_at >= ? ORDER BY event_at LIMIT 8").bind(new Date().toISOString().slice(0,10)).all<RecordRow>();
  const stock = await stockRows(c.env.DB);
  const overdue = tasks.results.filter(t => (t.due_at ?? '') < new Date().toISOString().slice(0,10)).length;
  const pendingRoi = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM roi_milestones WHERE status != 'Concluído' AND due_at < ?").bind(new Date().toISOString().slice(0,10)).first<{ count: number }>();
  return c.json({ data: { statusCounts, upcomingTasks: tasks.results.map(toRecord), upcomingEvents: events.results.map(toRecord),
    alerts: { overdueTasks: overdue, criticalStock: stock.filter(v => v.available < v.minimum).length, pendingRoi: pendingRoi?.count ?? 0 } } });
});

domainApi.get('/settings', async c => {
  const rows = await c.env.DB.prepare('SELECT * FROM app_settings').all<{ key: string; value_json: string }>();
  return c.json({ data: Object.fromEntries(rows.results.map(r => [r.key, JSON.parse(r.value_json)])) });
});
domainApi.put('/settings/:key', async c => {
  const key = c.req.param('key');
  if (!['categories', 'owners', 'priorities', 'agencyUrl', 'notionSources', 'statuses', 'templates'].includes(key)) return c.json({ error: 'Configuração desconhecida' }, 400);
  const value = await c.req.json().catch(() => null);
  if (value === null) return c.json({ error: 'JSON inválido' }, 400);
  await c.env.DB.prepare('INSERT INTO app_settings (key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at')
    .bind(key, JSON.stringify(value), new Date().toISOString()).run();
  return c.json({ data: { key, value } });
});

domainApi.get('/search', async c => {
  const query = (c.req.query('q') ?? '').trim();
  if (query.length < 2) return c.json({ data: [] });
  const escaped = query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
  const rows = await c.env.DB.prepare(`SELECT id,kind,title,status FROM records
    WHERE archived_at IS NULL AND title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 12`)
    .bind(`%${escaped}%`).all<{ id: string; kind: string; title: string; status: string }>();
  return c.json({ data: rows.results });
});

domainApi.post('/import/roi-csv', async c => {
  const body = await c.req.json().catch(() => null) as { csv?: string } | null;
  if (!body?.csv || body.csv.length > 2_000_000) return c.json({ error: 'CSV ausente ou grande demais' }, 400);
  let rows: string[][];
  try { rows = parseCsv(body.csv); } catch (error) { return c.json({ error: String(error) }, 400); }
  const [headers, ...values] = rows;
  const required = ['event_id', 'external_id', 'account', 'amount_cents', 'stage'];
  if (!headers || required.some(v => !headers.includes(v))) return c.json({ error: `Colunas obrigatórias: ${required.join(', ')}` }, 400);
  const positions = Object.fromEntries(headers.map((h, i) => [h, i]));
  const statements: D1PreparedStatement[] = [];
  const touchedEvents = new Set<string>();
  for (const row of values) {
    const eventId = row[positions.event_id]?.trim(); const externalId = row[positions.external_id]?.trim();
    const account = row[positions.account]?.trim(); const amount = Number(row[positions.amount_cents]);
    const stage = row[positions.stage]?.trim();
    if (!eventId || !externalId || !account || !Number.isInteger(amount) || amount < 0 || !stage) return c.json({ error: 'Linha CSV inválida' }, 400);
    touchedEvents.add(eventId);
    statements.push(c.env.DB.prepare(`INSERT INTO roi_opportunities
      (id,event_id,external_id,account,amount_cents,stage,close_date,owner,updated_at) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(event_id,external_id) DO UPDATE SET account=excluded.account,amount_cents=excluded.amount_cents,
      stage=excluded.stage,close_date=excluded.close_date,owner=excluded.owner,updated_at=excluded.updated_at`)
      .bind(crypto.randomUUID(), eventId, externalId, account, amount, stage,
        row[positions.close_date] || null, row[positions.owner] || null, new Date().toISOString()));
  }
  for (let i = 0; i < statements.length; i += 40) await c.env.DB.batch(statements.slice(i, i + 40));
  for (const eventId of touchedEvents) {
    const event = await getRecord(c.env.DB, 'event', eventId);
    if (event) await c.env.DB.batch(touchRecordStatements(c.env.DB, event));
  }
  return c.json({ data: { imported: values.length } });
});
