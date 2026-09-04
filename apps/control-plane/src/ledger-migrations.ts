interface LedgerMigration {
  readonly statements: string;
  readonly version: number;
}

const baselineTableNames = [
  "metadata",
  "publications",
  "runs",
  "transition_operations",
] as const;

const ledgerMigrations: readonly LedgerMigration[] = [
  {
    statements: `
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        pr_key TEXT NOT NULL,
        state TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        workflow_instance_id TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE TABLE metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE publications (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        finding_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        marker TEXT NOT NULL,
        state TEXT NOT NULL,
        github_comment_id INTEGER
      );
      CREATE INDEX publications_run_id ON publications(run_id);
      CREATE TABLE transition_operations (
        operation_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        expected_state TEXT NOT NULL,
        next_state TEXT NOT NULL
      );
    `,
    version: 1,
  },
  {
    statements: `
      ALTER TABLE runs ADD COLUMN causal_version TEXT NOT NULL DEFAULT '';
      UPDATE runs SET causal_version = created_at WHERE causal_version = '';
      CREATE TABLE cleanup_tasks (
        run_id TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK (state IN ('pending', 'completed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        requested_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX cleanup_tasks_pending
        ON cleanup_tasks(state, requested_at);
      CREATE TABLE credential_scopes (
        run_id TEXT PRIMARY KEY,
        installation_id INTEGER NOT NULL,
        repository_id INTEGER NOT NULL,
        repository_owner TEXT NOT NULL,
        repository_name TEXT NOT NULL,
        container_id TEXT NOT NULL
      );
      INSERT INTO metadata (key, value)
        SELECT 'latest_causal_version', runs.causal_version
        FROM runs JOIN metadata ON metadata.value = runs.id
        WHERE metadata.key = 'latest_run_id'
        ON CONFLICT(key) DO NOTHING;
      INSERT INTO metadata (key, value)
        SELECT 'latest_received_at', runs.created_at
        FROM runs JOIN metadata ON metadata.value = runs.id
        WHERE metadata.key = 'latest_run_id'
        ON CONFLICT(key) DO NOTHING;
    `,
    version: 2,
  },
  {
    statements: `
      ALTER TABLE runs ADD COLUMN github_check_run_id INTEGER;
    `,
    version: 3,
  },
  {
    statements: `
      CREATE TABLE IF NOT EXISTS pr_findings (
        pr_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        first_seen_run_id TEXT NOT NULL,
        last_seen_run_id TEXT NOT NULL,
        first_seen_head_sha TEXT NOT NULL,
        last_seen_head_sha TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('new', 'persistent', 'resolved', 'obsolete', 'reintroduced', 'dismissed')),
        severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
        file_path TEXT NOT NULL,
        line INTEGER NOT NULL,
        diagnostic TEXT NOT NULL,
        github_comment_id INTEGER,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (pr_key, fingerprint)
      );
      CREATE INDEX IF NOT EXISTS pr_findings_status ON pr_findings(pr_key, status);
    `,
    version: 4,
  },
  {
    statements: `
      CREATE TABLE IF NOT EXISTS finding_feedbacks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pr_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        label TEXT NOT NULL,
        author_login TEXT NOT NULL,
        reason TEXT,
        target_severity TEXT,
        github_comment_id INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS finding_feedbacks_pr_fp ON finding_feedbacks(pr_key, fingerprint);

      DROP TABLE IF EXISTS pr_findings_v5;
      CREATE TABLE pr_findings_v5 (
        pr_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        first_seen_run_id TEXT NOT NULL,
        last_seen_run_id TEXT NOT NULL,
        first_seen_head_sha TEXT NOT NULL,
        last_seen_head_sha TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('new', 'persistent', 'resolved', 'obsolete', 'reintroduced', 'dismissed')),
        severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
        file_path TEXT NOT NULL,
        line INTEGER NOT NULL,
        diagnostic TEXT NOT NULL,
        github_comment_id INTEGER,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (pr_key, fingerprint)
      );
      INSERT OR IGNORE INTO pr_findings_v5 SELECT * FROM pr_findings;
      DROP TABLE pr_findings;
      ALTER TABLE pr_findings_v5 RENAME TO pr_findings;
      CREATE INDEX IF NOT EXISTS pr_findings_status ON pr_findings(pr_key, status);
    `,
    version: 5,
  },
  {
    statements: `
      CREATE TABLE IF NOT EXISTS ci_evidences (
        pr_key TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        markdown_content TEXT NOT NULL,
        workflow_run_id INTEGER,
        created_at TEXT NOT NULL,
        PRIMARY KEY (pr_key, head_sha)
      );
      CREATE INDEX IF NOT EXISTS ci_evidences_pr_head ON ci_evidences(pr_key, head_sha);
    `,
    version: 6,
  },
  {
    statements: `
      CREATE TABLE IF NOT EXISTS run_telemetry (
        run_id TEXT PRIMARY KEY,
        pr_key TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        queue_wait_ms INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        reasoning_tokens INTEGER,
        estimated_cost_usd REAL NOT NULL,
        estimated_cost_micro_usd INTEGER NOT NULL,
        pricing_model TEXT NOT NULL,
        tool_calls INTEGER NOT NULL,
        shards_count INTEGER NOT NULL,
        scope_status TEXT,
        terminal_state TEXT NOT NULL,
        verdict TEXT,
        is_degraded INTEGER NOT NULL,
        step_timings_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS run_telemetry_pr_key ON run_telemetry(pr_key);
    `,
    version: 7,
  },
  {
    statements: `
      ALTER TABLE pr_findings ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0;

      ALTER TABLE runs ADD COLUMN decision_head_sha TEXT;
      ALTER TABLE runs ADD COLUMN decision_scope_status TEXT;
      ALTER TABLE runs ADD COLUMN decision_shards_analyzed INTEGER;
      ALTER TABLE runs ADD COLUMN decision_total_shards INTEGER;
      ALTER TABLE runs ADD COLUMN decision_is_degraded INTEGER;

      ALTER TABLE finding_feedbacks ADD COLUMN delivery_id TEXT;
      ALTER TABLE finding_feedbacks ADD COLUMN author_association TEXT;
      ALTER TABLE finding_feedbacks ADD COLUMN reply_comment_id INTEGER;
      CREATE UNIQUE INDEX finding_feedbacks_delivery
        ON finding_feedbacks(delivery_id)
        WHERE delivery_id IS NOT NULL;
    `,
    version: 8,
  },
  {
    statements: `
      ALTER TABLE cleanup_tasks ADD COLUMN next_attempt_at TEXT;
      UPDATE cleanup_tasks
        SET next_attempt_at = requested_at
        WHERE next_attempt_at IS NULL;
      CREATE INDEX IF NOT EXISTS cleanup_tasks_due
        ON cleanup_tasks(state, next_attempt_at, requested_at);

      CREATE TABLE IF NOT EXISTS workflow_supersessions (
        superseded_run_id TEXT PRIMARY KEY,
        workflow_instance_id TEXT NOT NULL,
        superseded_by_run_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'completed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        requested_at TEXT NOT NULL,
        next_attempt_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS workflow_supersessions_due
        ON workflow_supersessions(state, next_attempt_at, requested_at);
    `,
    version: 9,
  },
  {
    statements: `
      ALTER TABLE run_telemetry ADD COLUMN policy_source TEXT;
      ALTER TABLE run_telemetry ADD COLUMN source_digest TEXT;
      ALTER TABLE run_telemetry ADD COLUMN effective_policy_digest TEXT;
    `,
    version: 10,
  },
  {
    statements: `
      CREATE TABLE IF NOT EXISTS projection_tasks (
        run_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'completed', 'exhausted')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        requested_at TEXT NOT NULL,
        next_attempt_at TEXT NOT NULL,
        lease_expires_at TEXT,
        completed_at TEXT,
        last_error_kind TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_projection_tasks_due
        ON projection_tasks(state, next_attempt_at, run_id);
      ALTER TABLE ci_evidences ADD COLUMN structured_ci_json TEXT;
    `,
    version: 11,
  },
] as const;

function baselineTables(sql: SqlStorage): readonly string[] {
  return sql
    .exec<{ name: string }>(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name IN (?, ?, ?, ?)
       ORDER BY name`,
      ...baselineTableNames,
    )
    .toArray()
    .map((row) => row.name);
}

export function applyLedgerMigrations(storage: DurableObjectStorage): void {
  const sql = storage.sql;
  storage.transactionSync(() => {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
  });

  let applied = new Set(
    sql
      .exec<{ version: number }>(
        "SELECT version FROM schema_migrations ORDER BY version",
      )
      .toArray()
      .map((row) => row.version),
  );
  if (applied.size === 0) {
    const existingBaseline = baselineTables(sql);
    if (existingBaseline.length > 0) {
      if (
        existingBaseline.length !== baselineTableNames.length ||
        existingBaseline.some(
          (name, index) => name !== [...baselineTableNames].toSorted()[index],
        )
      ) {
        throw new Error("Ledger legacy schema is incomplete");
      }
      storage.transactionSync(() => {
        sql.exec(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        );
      });
      applied = new Set([1]);
    }
  }

  for (const migration of ledgerMigrations) {
    if (applied.has(migration.version)) continue;
    storage.transactionSync(() => {
      sql.exec(migration.statements);
      sql.exec(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        migration.version,
      );
    });
    applied.add(migration.version);
  }
}
