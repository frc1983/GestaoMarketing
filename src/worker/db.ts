import type { MarketingRecord, RecordKind } from '../shared/types';

export interface RecordRow {
  id: string; kind: RecordKind; title: string; status: string; due_at: string | null;
  event_at: string | null; owner: string | null; project_id: string | null;
  event_id: string | null; agency_status: string | null; data_json: string;
  version: number; created_at: string; updated_at: string; archived_at: string | null;
}

export function toRecord(row: RecordRow): MarketingRecord {
  return {
    id: row.id, kind: row.kind, title: row.title, status: row.status,
    dueAt: row.due_at, eventAt: row.event_at, owner: row.owner,
    projectId: row.project_id, eventId: row.event_id, agencyStatus: row.agency_status,
    data: JSON.parse(row.data_json) as Record<string, unknown>, version: row.version,
    createdAt: row.created_at, updatedAt: row.updated_at, archivedAt: row.archived_at,
  };
}

export async function getRecord(db: D1Database, kind: RecordKind, id: string): Promise<MarketingRecord | null> {
  const row = await db.prepare('SELECT * FROM records WHERE id = ? AND kind = ? AND archived_at IS NULL')
    .bind(id, kind).first<RecordRow>();
  return row ? toRecord(row) : null;
}

export function insertRecordStatement(db: D1Database, record: MarketingRecord): D1PreparedStatement {
  return db.prepare(`INSERT INTO records
    (id, kind, title, status, due_at, event_at, owner, project_id, event_id, agency_status,
     data_json, version, created_at, updated_at, archived_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(record.id, record.kind, record.title, record.status, record.dueAt ?? null,
      record.eventAt ?? null, record.owner ?? null, record.projectId ?? null, record.eventId ?? null,
      record.agencyStatus ?? null, JSON.stringify(record.data), record.version,
      record.createdAt, record.updatedAt, record.archivedAt ?? null);
}

export function updateRecordStatement(db: D1Database, record: MarketingRecord, priorVersion: number): D1PreparedStatement {
  return db.prepare(`UPDATE records SET title=?, status=?, due_at=?, event_at=?, owner=?, project_id=?,
    event_id=?, agency_status=?, data_json=?, version=?, updated_at=?, archived_at=?
    WHERE id=? AND version=?`)
    .bind(record.title, record.status, record.dueAt ?? null, record.eventAt ?? null,
      record.owner ?? null, record.projectId ?? null, record.eventId ?? null,
      record.agencyStatus ?? null, JSON.stringify(record.data), record.version,
      record.updatedAt, record.archivedAt ?? null, record.id, priorVersion);
}

export function outboxStatement(db: D1Database, record: MarketingRecord): D1PreparedStatement {
  return db.prepare(`INSERT INTO notion_outbox
    (id, record_id, version, status, next_attempt_at, created_at) VALUES (?, ?, ?, 'pending', ?, ?)`)
    .bind(crypto.randomUUID(), record.id, record.version, record.updatedAt, record.updatedAt);
}

export async function saveRecord(db: D1Database, record: MarketingRecord, priorVersion?: number): Promise<void> {
  const statement = priorVersion === undefined
    ? insertRecordStatement(db, record)
    : updateRecordStatement(db, record, priorVersion);
  const results = await db.batch([statement, outboxStatement(db, record)]);
  if (priorVersion !== undefined && results[0].meta.changes !== 1) throw new Error('Registro alterado em outra sessão');
}

export function touchRecordStatements(db: D1Database, record: MarketingRecord): D1PreparedStatement[] {
  const updated: MarketingRecord = { ...record, version: record.version + 1, updatedAt: new Date().toISOString() };
  return [updateRecordStatement(db, updated, record.version), outboxStatement(db, updated)];
}
