CREATE TABLE admin_runs (
  run_id TEXT PRIMARY KEY,
  repository_id INTEGER NOT NULL CHECK (repository_id > 0),
  repository_owner TEXT NOT NULL CHECK (length(repository_owner) BETWEEN 1 AND 100),
  repository_name TEXT NOT NULL CHECK (length(repository_name) BETWEEN 1 AND 100),
  pr_key TEXT NOT NULL,
  pr_number INTEGER NOT NULL CHECK (pr_number > 0),
  head_sha TEXT NOT NULL CHECK (length(head_sha) = 40),
  terminal_state TEXT NOT NULL CHECK (terminal_state IN ('completed', 'failed_terminal', 'obsolete')),
  verdict TEXT CHECK (verdict IN ('APPROVE', 'REQUEST_CHANGES', 'COMMENT') OR verdict IS NULL),
  scope_status TEXT CHECK (scope_status IN ('complete', 'partial_by_policy', 'partial_by_failure', 'unsupported') OR scope_status IS NULL),
  review_phase_reached TEXT NOT NULL CHECK (review_phase_reached IN ('admitted', 'repository_prepared', 'analysis_started', 'analyzed', 'publishing')),
  review_admission_wait_ms INTEGER NOT NULL CHECK (review_admission_wait_ms >= 0),
  execution_duration_ms INTEGER NOT NULL CHECK (execution_duration_ms >= 0),
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  reasoning_tokens INTEGER CHECK (reasoning_tokens >= 0 OR reasoning_tokens IS NULL),
  tool_calls_count INTEGER NOT NULL CHECK (tool_calls_count >= 0),
  estimated_cost_micro_usd INTEGER NOT NULL CHECK (estimated_cost_micro_usd >= 0),
  pricing_model TEXT NOT NULL CHECK (length(pricing_model) BETWEEN 1 AND 100),
  shards_count INTEGER NOT NULL CHECK (shards_count >= 0),
  is_degraded INTEGER NOT NULL CHECK (is_degraded IN (0, 1)),
  webhook_received_at TEXT NOT NULL,
  workflow_started_at TEXT NOT NULL,
  analysis_started_at TEXT,
  terminal_at TEXT NOT NULL,
  terminal_at_epoch_ms INTEGER NOT NULL CHECK (terminal_at_epoch_ms > 0),
  projection_requested_at TEXT NOT NULL,
  projected_at TEXT NOT NULL,
  projected_at_epoch_ms INTEGER NOT NULL CHECK (projected_at_epoch_ms > 0),
  projection_delivery_lag_ms INTEGER NOT NULL CHECK (projection_delivery_lag_ms >= 0),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  record_version INTEGER NOT NULL CHECK (record_version = 1),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  source_event_id TEXT NOT NULL UNIQUE
);

CREATE INDEX idx_admin_runs_cursor
  ON admin_runs(terminal_at_epoch_ms DESC, run_id DESC);
CREATE INDEX idx_admin_runs_repo_cursor
  ON admin_runs(repository_id, terminal_at_epoch_ms DESC, run_id DESC);
CREATE INDEX idx_admin_runs_state_cursor
  ON admin_runs(terminal_state, terminal_at_epoch_ms DESC, run_id DESC);
CREATE INDEX idx_admin_runs_repo_pr
  ON admin_runs(repository_id, pr_number, terminal_at_epoch_ms DESC, run_id DESC);
CREATE INDEX idx_admin_runs_head_sha
  ON admin_runs(head_sha);

CREATE TABLE admin_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at_epoch_ms INTEGER NOT NULL
);

CREATE TABLE admin_projection_quarantine (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observed_event_id_hash TEXT,
  observed_run_id_hash TEXT,
  computed_payload_hash TEXT NOT NULL CHECK (length(computed_payload_hash) = 64),
  payload_bytes INTEGER NOT NULL CHECK (payload_bytes >= 0),
  observed_schema_version INTEGER,
  error_code TEXT NOT NULL CHECK (length(error_code) BETWEEN 1 AND 100),
  created_at_epoch_ms INTEGER NOT NULL CHECK (created_at_epoch_ms > 0)
);

CREATE INDEX idx_admin_projection_quarantine_created
  ON admin_projection_quarantine(created_at_epoch_ms);
