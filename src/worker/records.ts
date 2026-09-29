import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { AGENCY_STATUSES, EVENT_STATUSES, PROJECT_STATUSES, ROI_STATUSES, TASK_STATUSES, type MarketingRecord, type RecordKind } from '../shared/types';
import { getRecord, insertRecordStatement, outboxStatement, toRecord, touchRecordStatements, updateRecordStatement, type RecordRow } from './db';
import type { Env } from './env';

type Bindings = { Bindings: Env; Variables: { csrfToken: string } };
export const recordsApi = new Hono<Bindings>();
const routes: Record<string, RecordKind> = { tasks: 'task', projects: 'project', events: 'event', roi: 'roi', 'stock/items': 'stock_item' };
const statuses: Record<RecordKind, readonly string[]> = {
  task: TASK_STATUSES, project: PROJECT_STATUSES, event: EVENT_STATUSES,
  roi: ROI_STATUSES, stock_item: ['Ativo', 'Inativo'],
};
const recordInput = z.object({
  title: z.string().trim().min(1).max(300),
  status: z.string().optional(), dueAt: z.string().nullish(), eventAt: z.string().nullish(),
  owner: z.string().nullish(), projectId: z.string().nullish(), eventId: z.string().nullish(),
  agencyStatus: z.string().nullish(), data: z.record(z.string(), z.unknown()).default({}),
});
const phaseTemplates: Record<string, string[]> = {
  Campanha: ['Planejamento', 'Conteúdo', 'Design', 'Aprovação', 'Programação', 'Publicação', 'Métricas'],
  Evento: ['Planejamento', 'Budget', 'Contratação', 'Comunicação', 'Materiais', 'Logística', 'Execução', 'Pós-evento', 'ROI'],
  Vídeo: ['Pauta', 'Roteiro', 'Aprovação', 'Gravação', 'Edição', 'Aprovação final', 'Publicação'],
};
async function allowedStatuses(db: D1Database, kind: RecordKind): Promise<readonly string[]> {
  const row = await db.prepare("SELECT value_json FROM app_settings WHERE key='statuses'").first<{ value_json: string }>();
  const configured = row ? JSON.parse(row.value_json) as Record<string, unknown> : {};
  const values = configured[kind];
  return Array.isArray(values) && values.every(v => typeof v === 'string') && values.length ? values : statuses[kind];
}

async function configuredTemplate(db: D1Database, name: string): Promise<string[]> {
  const row = await db.prepare("SELECT value_json FROM app_settings WHERE key='templates'").first<{ value_json: string }>();
  const configured = row ? JSON.parse(row.value_json) as Record<string, unknown> : {};
  const phases = configured[name];
  return Array.isArray(phases) && phases.every(v => typeof v === 'string') && phases.length
    ? phases as string[] : phaseTemplates[name] ?? phaseTemplates.Campanha;
}
function routeKind(path: string): RecordKind | undefined { return routes[path]; }
function cleanValue(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function validDate(value: string | null | undefined): boolean { return !value || !Number.isNaN(Date.parse(value)); }

async function listRecords(c: Context<Bindings>, kind: RecordKind) {
  const status = c.req.query('status');
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 100, 1), 500);
  const query = status
    ? c.env.DB.prepare('SELECT * FROM records WHERE kind=? AND status=? AND archived_at IS NULL ORDER BY updated_at DESC LIMIT ?').bind(kind, status, limit)
    : c.env.DB.prepare('SELECT * FROM records WHERE kind=? AND archived_at IS NULL ORDER BY updated_at DESC LIMIT ?').bind(kind, limit);
  const rows = await query.all<RecordRow>();
  return c.json({ data: rows.results.map(toRecord) });
}

for (const [route, kind] of Object.entries(routes)) {
  recordsApi.get(`/${route}`, c => listRecords(c, kind));
  recordsApi.get(`/${route}/:id`, async c => {
    const record = await getRecord(c.env.DB, kind, c.req.param('id'));
    return record ? c.json({ data: record }) : c.json({ error: 'Registro não encontrado' }, 404);
  });
  recordsApi.post(`/${route}`, async c => {
    const parsed = recordInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Dados inválidos', details: parsed.error.flatten() }, 400);
    const input = parsed.data;
    const status = input.status ?? statuses[kind][0];
    if (!(await allowedStatuses(c.env.DB, kind)).includes(status) || (input.agencyStatus && !AGENCY_STATUSES.includes(input.agencyStatus as typeof AGENCY_STATUSES[number])) || !validDate(input.dueAt) || !validDate(input.eventAt))
      return c.json({ error: 'Status ou data inválida' }, 400);
    const now = new Date().toISOString();
    const record: MarketingRecord = {
      id: crypto.randomUUID(), kind, title: input.title, status,
      dueAt: input.dueAt ?? null, eventAt: input.eventAt ?? null,
      owner: cleanValue(input.owner), projectId: cleanValue(input.projectId), eventId: cleanValue(input.eventId),
      agencyStatus: cleanValue(input.agencyStatus), data: input.data, version: 1,
      createdAt: now, updatedAt: now, archivedAt: null,
    };
    const statements = [insertRecordStatement(c.env.DB, record), outboxStatement(c.env.DB, record)];
    if (kind === 'project') {
      const template = typeof input.data.template === 'string' ? input.data.template : 'Campanha';
      for (const [position, name] of (await configuredTemplate(c.env.DB, template)).entries())
        statements.push(c.env.DB.prepare('INSERT INTO project_phases (id, project_id, name, position) VALUES (?, ?, ?, ?)')
          .bind(crypto.randomUUID(), record.id, name, position));
    }
    if (kind === 'stock_item') {
      const initialVariant = typeof input.data.initialVariant === 'string' && input.data.initialVariant.trim() ? input.data.initialVariant.trim() : 'Padrão';
      const variantId = crypto.randomUUID();
      statements.push(c.env.DB.prepare('INSERT INTO stock_variants (id, item_id, name, minimum) VALUES (?, ?, ?, ?)')
        .bind(variantId, record.id, initialVariant, Number(input.data.minimum) || 0));
      const initialQuantity = Number(input.data.initialQuantity ?? 0);
      if (!Number.isInteger(initialQuantity) || initialQuantity < 0) return c.json({ error: 'Quantidade inicial inválida' }, 400);
      if (initialQuantity) statements.push(c.env.DB.prepare('INSERT INTO stock_movements (id,item_id,variant_id,quantity,reason,created_at) VALUES (?,?,?,?,?,?)')
        .bind(crypto.randomUUID(), record.id, variantId, initialQuantity, 'Saldo inicial', now));
    }
    await c.env.DB.batch(statements);
    return c.json({ data: record }, 201);
  });
  recordsApi.patch(`/${route}/:id`, async c => {
    const existing = await getRecord(c.env.DB, kind, c.req.param('id'));
    if (!existing) return c.json({ error: 'Registro não encontrado' }, 404);
    const raw = await c.req.json().catch(() => null);
    if (!raw || typeof raw !== 'object') return c.json({ error: 'Dados inválidos' }, 400);
    const parsed = recordInput.safeParse({ ...existing, ...raw, data: { ...existing.data, ...(raw as { data?: object }).data } });
    if (!parsed.success) return c.json({ error: 'Dados inválidos', details: parsed.error.flatten() }, 400);
    const input = parsed.data;
    const status = input.status ?? existing.status;
    if (!(await allowedStatuses(c.env.DB, kind)).includes(status) || (input.agencyStatus && !AGENCY_STATUSES.includes(input.agencyStatus as typeof AGENCY_STATUSES[number])) || !validDate(input.dueAt) || !validDate(input.eventAt))
      return c.json({ error: 'Status ou data inválida' }, 400);
    const updated: MarketingRecord = {
      ...existing, title: input.title, status, dueAt: input.dueAt ?? null,
      eventAt: input.eventAt ?? null, owner: cleanValue(input.owner),
      projectId: cleanValue(input.projectId), eventId: cleanValue(input.eventId),
      agencyStatus: cleanValue(input.agencyStatus), data: input.data,
      version: existing.version + 1, updatedAt: new Date().toISOString(),
    };
    if (kind === 'task' && status === 'Concluído' && existing.status !== 'Concluído') updated.data.completedAt = updated.updatedAt;
    const statements = [updateRecordStatement(c.env.DB, updated, existing.version), outboxStatement(c.env.DB, updated)];
    const results = await c.env.DB.batch(statements);
    if (results[0].meta.changes !== 1) return c.json({ error: 'Conflito de versão' }, 409);
    return c.json({ data: updated });
  });
  recordsApi.delete(`/${route}/:id`, async c => {
    const existing = await getRecord(c.env.DB, kind, c.req.param('id'));
    if (!existing) return c.json({ error: 'Registro não encontrado' }, 404);
    const updated = { ...existing, version: existing.version + 1, updatedAt: new Date().toISOString(), archivedAt: new Date().toISOString() };
    await c.env.DB.batch([updateRecordStatement(c.env.DB, updated, existing.version), outboxStatement(c.env.DB, updated)]);
    return c.json({ data: { archived: true } });
  });
}

recordsApi.get('/projects/:id/phases', async c => {
  const result = await c.env.DB.prepare('SELECT * FROM project_phases WHERE project_id=? ORDER BY position').bind(c.req.param('id')).all();
  return c.json({ data: result.results });
});
recordsApi.patch('/projects/:id/phases/:phaseId', async c => {
  const body = await c.req.json().catch(() => null) as { status?: string } | null;
  if (!body || !['A fazer', 'Em andamento', 'Concluído'].includes(body.status ?? '')) return c.json({ error: 'Status inválido' }, 400);
  const existing = await getRecord(c.env.DB, 'project', c.req.param('id'));
  if (!existing) return c.json({ error: 'Projeto não encontrado' }, 404);
  const result = await c.env.DB.prepare('UPDATE project_phases SET status=?, completed_at=? WHERE id=? AND project_id=?')
    .bind(body.status, body.status === 'Concluído' ? new Date().toISOString() : null, c.req.param('phaseId'), existing.id).run();
  if (result.meta.changes !== 1) return c.json({ error: 'Fase não encontrada' }, 404);
  const phases = await c.env.DB.prepare('SELECT status FROM project_phases WHERE project_id=?').bind(existing.id).all<{ status: string }>();
  const progress = phases.results.length ? Math.round(phases.results.filter(p => p.status === 'Concluído').length / phases.results.length * 100) : 0;
  const updated = { ...existing, data: { ...existing.data, progress }, version: existing.version + 1, updatedAt: new Date().toISOString() };
  await c.env.DB.batch([updateRecordStatement(c.env.DB, updated, existing.version), outboxStatement(c.env.DB, updated)]);
  return c.json({ data: { progress } });
});
