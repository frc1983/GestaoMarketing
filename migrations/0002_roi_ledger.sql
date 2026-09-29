CREATE TABLE IF NOT EXISTS roi_ledger_entries (
  id TEXT PRIMARY KEY,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('debit','credit')),
  allocation TEXT,
  expense_category TEXT,
  company TEXT,
  service TEXT,
  client TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  occurred_on TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK (
    (entry_type='debit' AND allocation IS NOT NULL AND expense_category IS NOT NULL AND company IS NOT NULL)
    OR (entry_type='credit' AND service IS NOT NULL AND client IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_roi_ledger_active_date ON roi_ledger_entries(archived_at, occurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_roi_ledger_type ON roi_ledger_entries(entry_type, archived_at);
