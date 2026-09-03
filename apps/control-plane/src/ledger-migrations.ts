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
