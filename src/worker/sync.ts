import { Hono } from 'hono';
import { insertRecordStatement, toRecord, type RecordRow } from './db';
import type { Env } from './env';
import type { RecordKind, MarketingRecord } from '../shared/types';
import { TASK_STATUSES } from '../shared/types';

type Bindings = { Bindings: Env; Variables: { csrfToken: string } };
export const syncApi = new Hono<Bindings>();
const notionVersion = '2025-09-03';
const notionBase = 'https://api.notion.com/v1';
const sources: Record<RecordKind, keyof Env> = {
  task: 'NOTION_TASKS_DATA_SOURCE_ID', project: 'NOTION_PROJECTS_DATA_SOURCE_ID',
  event: 'NOTION_EVENTS_DATA_SOURCE_ID', roi: 'NOTION_ROI_DATA_SOURCE_ID',
  stock_item: 'NOTION_STOCK_DATA_SOURCE_ID',
};
const sourceSettingKeys: Record<RecordKind, string> = { task: 'tasks', project: 'projects', event: 'events', roi: 'roi', stock_item: 'stock' };

async function sourceIdFor(env: Env, kind: RecordKind): Promise<string | undefined> {
  const secretValue = env[sources[kind]] as string | undefined;
  if (secretValue) return secretValue;
  const row = await env.DB.prepare("SELECT value_json FROM app_settings WHERE key='notionSources'").first<{ value_json: string }>();
  if (!row) return undefined;
  try {
    const values = JSON.parse(row.value_json) as Record<string, unknown>;
    const value = values[sourceSettingKeys[kind]];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  } catch { return undefined; }
}

interface OutboxRow { id: string; record_id: string; version: number; attempts: number }
interface NotionLink { page_id: string; block_id: string | null }
interface NotionSource { properties: Record<string, { type: string; status?: { options?: Array<{ name: string }> }; select?: { options?: Array<{ name: string }> } }> }

async function notionRequest(env: Env, path: string, method = 'GET', body?: unknown): Promise<Response> {
  return fetch(`${notionBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': notionVersion,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function sourceProperties(env: Env, id: string): Promise<{ title: string; properties: NotionSource['properties']; externalId: string }> {
  const response = await notionRequest(env, `/data_sources/${id}`);
  if (!response.ok) throw new Error(`Notion data source ${response.status}`);
  const source = await response.json() as NotionSource;
  const title = Object.entries(source.properties).find(([, value]) => value.type === 'title')?.[0];
  if (!title) throw new Error('Data source Notion sem propriedade de título');
  if (!source.properties['Marketing OS ID']) {
    const change = await notionRequest(env, `/data_sources/${id}`, 'PATCH', { properties: { 'Marketing OS ID': { rich_text: {} } } });
    if (!change.ok) throw new Error(`Não foi possível criar Marketing OS ID no Notion: ${change.status}`);
    source.properties['Marketing OS ID'] = { type: 'rich_text' };
  }
  if (source.properties['Marketing OS ID'].type !== 'rich_text') throw new Error('Marketing OS ID deve ser rich_text');
  return { title, properties: source.properties, externalId: 'Marketing OS ID' };
}

function propertiesFor(record: MarketingRecord, fields: Awaited<ReturnType<typeof sourceProperties>>): Record<string, unknown> {
  const properties: Record<string, unknown> = { [fields.title]: { title: [{ text: { content: record.title.slice(0, 1900) } }] } };
  properties[fields.externalId] = { rich_text: [{ text: { content: record.id } }] };
  const fieldValues: Record<string, string | null | undefined> = {
    Status: record.status, Responsável: record.owner, Prazo: record.dueAt,
    Data: record.eventAt, 'Projeto ID': record.projectId, 'Evento ID': record.eventId,
    Agência: record.agencyStatus,
  };
  for (const [name, value] of Object.entries(fieldValues)) {
    const definition = fields.properties[name];
    if (!definition) continue;
    if (definition.type === 'rich_text') properties[name] = { rich_text: value ? [{ text: { content: value } }] : [] };
    if (definition.type === 'date') properties[name] = { date: value && !Number.isNaN(Date.parse(value)) ? { start: value } : null };
    if (definition.type === 'select') properties[name] = { select: value ? { name: value } : null };
    if (definition.type === 'status' && value && definition.status?.options?.some(o => o.name === value)) properties[name] = { status: { name: value } };
  }
  return properties;
}

async function detailText(env: Env, record: MarketingRecord): Promise<string> {
  const detail: Record<string, unknown> = { id: record.id, kind: record.kind, status: record.status,
    dueAt: record.dueAt, eventAt: record.eventAt, owner: record.owner, projectId: record.projectId,
    eventId: record.eventId, agencyStatus: record.agencyStatus, data: record.data };
  if (record.kind === 'project') detail.phases = (await env.DB.prepare('SELECT name,status,completed_at FROM project_phases WHERE project_id=? ORDER BY position').bind(record.id).all()).results;
  if (record.kind === 'event') {
    detail.milestones = (await env.DB.prepare('SELECT phase,due_at,status,completed_at,notes FROM roi_milestones WHERE event_id=?').bind(record.id).all()).results;
    detail.opportunities = (await env.DB.prepare('SELECT account,amount_cents,stage,close_date,owner FROM roi_opportunities WHERE event_id=?').bind(record.id).all()).results;
  }
  if (record.kind === 'stock_item') {
    detail.variants = (await env.DB.prepare('SELECT id,name,minimum FROM stock_variants WHERE item_id=?').bind(record.id).all()).results;
    detail.movements = (await env.DB.prepare('SELECT variant_id,quantity,reason,requester,event_id,client,created_at FROM stock_movements WHERE item_id=? ORDER BY created_at DESC LIMIT 100').bind(record.id).all()).results;
    detail.reservations = (await env.DB.prepare('SELECT variant_id,quantity,reason,requester,event_id,client,status FROM stock_reservations WHERE item_id=?').bind(record.id).all()).results;
  }
  return JSON.stringify(detail);
}

async function appendBlocks(env: Env, pageId: string, detail: string): Promise<string[]> {
  const chunks = detail.match(/[\s\S]{1,1800}/g) ?? ['{}'];
  if (chunks.length > 100) throw new Error('Registro grande demais para projeção no Notion');
  const response = await notionRequest(env, `/blocks/${pageId}/children`, 'PATCH', {
    children: chunks.map((content, i) => ({ object: 'block', type: 'code',
      code: { language: 'json', caption: i === 0 ? [{ text: { content: 'Marketing OS' } }] : [], rich_text: [{ text: { content } }] } })),
  });
  if (!response.ok) throw new Error(`Notion block ${response.status}`);
  const body = await response.json() as { results?: Array<{ id: string }> };
  if (!body.results || body.results.length !== chunks.length) throw new Error('Notion não retornou os blocos criados');
  return body.results.map(v => v.id);
}

async function findByExternalId(env: Env, sourceId: string, recordId: string): Promise<string | null> {
  const response = await notionRequest(env, `/data_sources/${sourceId}/query`, 'POST', {
    filter: { property: 'Marketing OS ID', rich_text: { equals: recordId } }, page_size: 2,
  });
  if (!response.ok) throw new Error(`Busca Notion ${response.status}`);
  const body = await response.json() as { results?: Array<{ id: string }> };
  if ((body.results?.length ?? 0) > 1) throw new Error('Páginas duplicadas no Notion para Marketing OS ID');
  return body.results?.[0]?.id ?? null;
}

async function processOne(env: Env, row: OutboxRow): Promise<void> {
  const result = await env.DB.prepare('SELECT * FROM records WHERE id=?').bind(row.record_id).first<RecordRow>();
  if (!result) return;
  const record = toRecord(result);
  const sourceId = await sourceIdFor(env, record.kind);
  if (!env.NOTION_TOKEN || !sourceId) throw new Error(`Integração Notion não configurada para ${record.kind}`);
  const fields = await sourceProperties(env, sourceId);
  const link = await env.DB.prepare('SELECT page_id,block_id FROM notion_links WHERE record_id=?')
    .bind(record.id).first<NotionLink>();
  let pageId = link?.page_id ?? await findByExternalId(env, sourceId, record.id);
  const oldBlockIds: string[] = link?.block_id ? JSON.parse(link.block_id) as string[] : [];
  if (!pageId) {
    const response = await notionRequest(env, '/pages', 'POST', {
      parent: { type: 'data_source_id', data_source_id: sourceId },
      properties: propertiesFor(record, fields),
    });
    if (!response.ok) throw new Error(`Notion create ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const page = await response.json() as { id: string };
    pageId = page.id;
    await env.DB.prepare('INSERT OR IGNORE INTO notion_links (record_id,page_id,synced_version) VALUES (?,?,0)')
      .bind(record.id, pageId).run();
  } else {
    await env.DB.prepare('INSERT OR IGNORE INTO notion_links (record_id,page_id,synced_version) VALUES (?,?,0)')
      .bind(record.id, pageId).run();
    const response = await notionRequest(env, `/pages/${pageId}`, 'PATCH', record.archivedAt
      ? { archived: true } : { properties: propertiesFor(record, fields) });
    if (!response.ok) throw new Error(`Notion update ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  if (!record.archivedAt) {
    const newIds = await appendBlocks(env, pageId, await detailText(env, record));
    await env.DB.prepare('UPDATE notion_links SET block_id=? WHERE record_id=?').bind(JSON.stringify(newIds), record.id).run();
    for (const oldId of oldBlockIds) await notionRequest(env, `/blocks/${oldId}`, 'PATCH', { archived: true });
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE notion_links SET synced_version=?,synced_at=? WHERE record_id=?').bind(record.version, now, record.id),
    env.DB.prepare("UPDATE notion_outbox SET status='done',last_error=NULL WHERE id=?").bind(row.id),
    env.DB.prepare("UPDATE notion_outbox SET status='done' WHERE record_id=? AND version<? AND status='pending'").bind(record.id, record.version),
  ]);
}

export async function drainOutbox(env: Env): Promise<void> {
  const rows = await env.DB.prepare("SELECT id,record_id,version,attempts FROM notion_outbox WHERE status='pending' AND next_attempt_at<=? ORDER BY created_at LIMIT 10")
    .bind(new Date().toISOString()).all<OutboxRow>();
  for (const row of rows.results) {
    try { await processOne(env, row); }
    catch (error) {
      const attempts = row.attempts + 1;
      const next = new Date(Date.now() + Math.min(2 ** attempts * 60_000, 6 * 60 * 60_000)).toISOString();
      await env.DB.prepare('UPDATE notion_outbox SET status=?,attempts=?,next_attempt_at=?,last_error=? WHERE id=?')
        .bind(attempts >= 8 ? 'failed' : 'pending', attempts, next, String(error).slice(0, 500), row.id).run();
    }
  }
}

syncApi.get('/sync/status', async c => {
  const rows = await c.env.DB.prepare('SELECT status, COUNT(*) AS count FROM notion_outbox GROUP BY status').all<{ status: string; count: number }>();
  const counts = Object.fromEntries(rows.results.map(v => [v.status, v.count]));
  const last = await c.env.DB.prepare("SELECT last_error FROM notion_outbox WHERE last_error IS NOT NULL ORDER BY created_at DESC LIMIT 1").first<{ last_error: string }>();
  const configuredSources = await Promise.all((Object.keys(sources) as RecordKind[]).map(kind => sourceIdFor(c.env, kind)));
  return c.json({ data: { pending: counts.pending ?? 0, failed: counts.failed ?? 0, synced: counts.done ?? 0,
    configured: Boolean(c.env.NOTION_TOKEN && configuredSources.some(Boolean)), lastError: last?.last_error ?? null } });
});
syncApi.post('/sync/retry', async c => {
  const body = await c.req.json().catch(() => ({})) as { id?: string };
  if (body.id) await c.env.DB.prepare("UPDATE notion_outbox SET status='pending', attempts=0, next_attempt_at=? WHERE id=?")
    .bind(new Date().toISOString(), body.id).run();
  else await c.env.DB.prepare("UPDATE notion_outbox SET status='pending', attempts=0, next_attempt_at=? WHERE status='failed'")
    .bind(new Date().toISOString()).run();
  return c.json({ data: { queued: true } });
});

const importStatuses = { task: TASK_STATUSES } as const;
interface NotionPage {
  id: string;
  properties: Record<string, { type: string; title?: Array<{ plain_text?: string }>; status?: { name?: string }; select?: { name?: string }; date?: { start?: string }; rich_text?: Array<{ plain_text?: string }> }>;
}

function pageValue(page: NotionPage, property: string): string | null {
  const value = page.properties[property];
  if (!value) return null;
  if (value.type === 'title') return value.title?.map(v => v.plain_text ?? '').join('') ?? null;
  if (value.type === 'rich_text') return value.rich_text?.map(v => v.plain_text ?? '').join('') ?? null;
  if (value.type === 'status') return value.status?.name ?? null;
  if (value.type === 'select') return value.select?.name ?? null;
  if (value.type === 'date') return value.date?.start ?? null;
  return null;
}

syncApi.get('/import/notion/preview', async c => {
  const kind = c.req.query('kind');
  if (kind !== 'task') return c.json({ error: 'A importação do Notion está disponível somente para Tarefas' }, 400);
  const sourceId = await sourceIdFor(c.env, kind);
  if (!c.env.NOTION_TOKEN || !sourceId) return c.json({ error: 'Integração Notion não configurada' }, 503);
  const fields = await sourceProperties(c.env, sourceId);
  const cursor = c.req.query('cursor');
  const response = await notionRequest(c.env, `/data_sources/${sourceId}/query`, 'POST', { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
  if (!response.ok) return c.json({ error: `Notion respondeu ${response.status}` }, 502);
  const body = await response.json() as { results: NotionPage[]; next_cursor?: string | null };
  return c.json({ data: { sourceId, nextCursor: body.next_cursor ?? null,
    pages: body.results.map(page => ({ pageId: page.id, title: pageValue(page, fields.title),
      status: pageValue(page, 'Status'), dueAt: pageValue(page, 'Prazo'), eventAt: pageValue(page, 'Data') })) } });
});

syncApi.post('/import/notion/confirm', async c => {
  const body = await c.req.json().catch(() => null) as { kind?: string; pageIds?: string[] } | null;
  if (body?.kind !== 'task' || !Array.isArray(body.pageIds) || body.pageIds.length > 50)
    return c.json({ error: 'A importação do Notion está disponível somente para Tarefas' }, 400);
  const sourceId = await sourceIdFor(c.env, body.kind);
  if (!c.env.NOTION_TOKEN || !sourceId) return c.json({ error: 'Integração Notion não configurada' }, 503);
  const fields = await sourceProperties(c.env, sourceId);
  const created: Array<{ id: string; pageId: string }> = [];
  for (const pageId of body.pageIds) {
    const linked = await c.env.DB.prepare('SELECT record_id FROM notion_links WHERE page_id=?').bind(pageId).first();
    if (linked) continue;
    const response = await notionRequest(c.env, `/pages/${encodeURIComponent(pageId)}`);
    if (!response.ok) return c.json({ error: `Não foi possível ler a página ${pageId}` }, 502);
    const page = await response.json() as NotionPage & { parent?: { data_source_id?: string } };
    if (page.parent?.data_source_id !== sourceId) return c.json({ error: 'Página fora da base selecionada' }, 400);
    const title = pageValue(page, fields.title)?.trim();
    if (!title) return c.json({ error: `Página ${pageId} sem título` }, 400);
    const rawStatus = pageValue(page, 'Status');
    const status = rawStatus && (importStatuses.task as readonly string[]).includes(rawStatus) ? rawStatus : importStatuses.task[0];
    const now = new Date().toISOString();
    const record: MarketingRecord = { id: crypto.randomUUID(), kind: body.kind, title, status,
      dueAt: pageValue(page, 'Prazo'), eventAt: pageValue(page, 'Data'),
      owner: pageValue(page, 'Responsável'), data: { importedFromNotion: true, originalStatus: rawStatus },
      version: 1, createdAt: now, updatedAt: now, archivedAt: null };
    await c.env.DB.batch([insertRecordStatement(c.env.DB, record),
      c.env.DB.prepare('INSERT INTO notion_links (record_id,page_id,synced_version,synced_at) VALUES (?,?,1,?)').bind(record.id, pageId, now)]);
    created.push({ id: record.id, pageId });
  }
  return c.json({ data: { imported: created.length, records: created } });
});
