-- Financial intelligence foundation. All records remain workspace-scoped and
-- additive so existing installations can migrate without rewriting history.

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  account_number TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ILS',
  current_balance REAL,
  balance_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, provider, account_number)
);
CREATE INDEX idx_accounts_workspace ON accounts(workspace_id);

CREATE TABLE account_balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  balance REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ILS',
  captured_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_balance_snapshots_account
  ON account_balance_snapshots(account_id, captured_at DESC);

CREATE TABLE recurring_series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  merchant_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  cadence TEXT NOT NULL CHECK(cadence IN ('weekly','monthly','quarterly','yearly','irregular')),
  average_amount REAL NOT NULL,
  monthly_cost REAL NOT NULL,
  next_expected_date TEXT,
  confidence REAL NOT NULL,
  occurrence_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'detected'
    CHECK(status IN ('detected','subscription','essential','ignored','cancelled')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, merchant_key)
);
CREATE INDEX idx_recurring_workspace ON recurring_series(workspace_id, status);

CREATE TABLE savings_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_amount REAL NOT NULL CHECK(target_amount > 0),
  current_amount REAL NOT NULL DEFAULT 0 CHECK(current_amount >= 0),
  target_date TEXT,
  priority INTEGER NOT NULL DEFAULT 2 CHECK(priority BETWEEN 1 AND 3),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','paused')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_goals_workspace ON savings_goals(workspace_id, status);

CREATE TABLE financial_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('recurring','price_increase','anomaly','budget_risk','fee','forecast')),
  severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  monthly_impact REAL,
  annual_impact REAL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','dismissed','resolved')),
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, fingerprint)
);
CREATE INDEX idx_insights_workspace ON financial_insights(workspace_id, status, severity);

CREATE TABLE agent_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  thread_id INTEGER REFERENCES chat_threads(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL CHECK(action_type IN ('update_budget','create_goal','dismiss_insight')),
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  precondition_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected','stale')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX idx_proposals_workspace ON agent_proposals(workspace_id, status);

CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor TEXT NOT NULL CHECK(actor IN ('user','agent')),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_workspace ON audit_events(workspace_id, created_at DESC);

CREATE TABLE notification_preferences (
  workspace_id INTEGER PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  weekly_digest INTEGER NOT NULL DEFAULT 1,
  anomaly_alerts INTEGER NOT NULL DEFAULT 1,
  budget_alerts INTEGER NOT NULL DEFAULT 1,
  forecast_alerts INTEGER NOT NULL DEFAULT 1,
  snoozed_until TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO notification_preferences (workspace_id)
SELECT id FROM workspaces;
