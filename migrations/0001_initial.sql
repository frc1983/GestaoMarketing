PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('task','project','event','roi','stock_item')),
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  due_at TEXT,
  event_at TEXT,
  owner TEXT,
  project_id TEXT,
  event_id TEXT,
  agency_status TEXT,
  data_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_records_kind_status ON records(kind, status, archived_at);
CREATE INDEX IF NOT EXISTS idx_records_kind_due ON records(kind, due_at, archived_at);
CREATE INDEX IF NOT EXISTS idx_records_event ON records(event_id);
CREATE INDEX IF NOT EXISTS idx_records_project ON records(project_id);

CREATE TABLE IF NOT EXISTS project_phases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES records(id),
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'A fazer',
  completed_at TEXT,
  UNIQUE(project_id, position)
);
CREATE INDEX IF NOT EXISTS idx_project_phases_project ON project_phases(project_id, position);

CREATE TABLE IF NOT EXISTS roi_milestones (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES records(id),
  phase TEXT NOT NULL CHECK (phase IN ('Pré-ROI','D+5','D+10','D+30','D+90','D+180')),
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'Pendente',
  completed_at TEXT,
  notes TEXT,
  UNIQUE(event_id, phase)
);
CREATE INDEX IF NOT EXISTS idx_roi_milestones_event ON roi_milestones(event_id, due_at);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_variants (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES records(id),
  name TEXT NOT NULL,
  minimum INTEGER NOT NULL DEFAULT 0,
  UNIQUE(item_id, name)
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES records(id),
  variant_id TEXT NOT NULL REFERENCES stock_variants(id),
  reservation_id TEXT UNIQUE,
  quantity INTEGER NOT NULL CHECK (quantity != 0),
  reason TEXT NOT NULL,
  requester TEXT,
  event_id TEXT,
  client TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_variant ON stock_movements(variant_id);
CREATE TABLE IF NOT EXISTS stock_reservations (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES records(id),
  variant_id TEXT NOT NULL REFERENCES stock_variants(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  reason TEXT NOT NULL,
  requester TEXT,
  event_id TEXT,
  client TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','fulfilled','cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_variant ON stock_reservations(variant_id, status);

CREATE TABLE IF NOT EXISTS roi_opportunities (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES records(id),
  external_id TEXT,
  account TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  stage TEXT NOT NULL,
  close_date TEXT,
  owner TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(event_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_roi_opportunities_event ON roi_opportunities(event_id, stage);

CREATE TABLE IF NOT EXISTS image_assets (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES records(id),
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notion_links (
  record_id TEXT PRIMARY KEY REFERENCES records(id),
  page_id TEXT NOT NULL UNIQUE,
  block_id TEXT,
  synced_version INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT
);
CREATE TABLE IF NOT EXISTS notion_outbox (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(record_id, version)
);
CREATE INDEX IF NOT EXISTS idx_notion_outbox_pending ON notion_outbox(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  row_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  ip_hash TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(ip_hash, attempted_at);
