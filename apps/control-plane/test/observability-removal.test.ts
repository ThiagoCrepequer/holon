import { reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it } from "vitest";

import { ReviewToolBudgetStore } from "../src/ledger/review-tool-budget-store.js";

afterEach(() => reset());

it("shares the 96-call durable limit across concurrent reservations and recreated clients", async () => {
  const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:11");
  const runId =
    `github:42:pr:11:head:${"a".repeat(40)}:base:${"b".repeat(40)}` as const;
  await ledger.claimRun(
    {
      id: runId,
      prKey: "github:42:pr:11",
      state: "queued",
      attempt: 0,
      createdAt: new Date().toISOString(),
      causalVersion: new Date().toISOString(),
    },
    "budget-test",
  );
  await ledger.transition(
    runId,
    "queued",
    "running",
    new Date().toISOString(),
    "budget-test:start",
  );
  const reservations = await Promise.all(
    Array.from({ length: 97 }, () =>
      ledger.reserveAnalysisToolCall(runId, 0, 2),
    ),
  );
  expect(reservations.filter(Boolean)).toHaveLength(96);
  const replay = env.REVIEW_LEDGERS.getByName("github:42:pr:11");
  expect(await replay.reserveAnalysisToolCall(runId, 0, 2)).toBe(false);
  expect(await replay.reserveAnalysisToolCall(runId, 1, 2)).toBe(false);
  const events = await runInDurableObject(ledger, (_object, state) => {
    const captured: unknown[] = [];
    const store = new ReviewToolBudgetStore(state.storage.sql, {
      emit(event, fields) {
        captured.push({ event, ...fields });
      },
    });
    expect(store.reserveToolCall(runId, 0, 2)).toBe(false);
    return captured;
  });
  expect(events).toEqual([
    expect.objectContaining({
      event: "repository.tool_budget_rejected",
      runId,
      shardIndex: 0,
      rule: "run_calls",
      shardCurrent: 96,
      totalCurrent: 96,
      totalLimit: 96,
    }),
  ]);
});

it("keeps review state and tool budgets without administrative storage", async () => {
  const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
  const runId =
    `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}` as const;
  await ledger.claimRun(
    {
      id: runId,
      prKey: "github:42:pr:7",
      state: "queued",
      attempt: 0,
      createdAt: new Date().toISOString(),
      causalVersion: new Date().toISOString(),
    },
    "removal-test",
  );
  await ledger.transition(
    runId,
    "queued",
    "running",
    new Date().toISOString(),
    "removal-test:start",
  );
  await runInDurableObject(ledger, (_object, state) => {
    const tables = state.storage.sql
      .exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      )
      .toArray()
      .map((row) => row.name);
    for (const retired of [
      "projection_tasks",
      "run_telemetry",
      "step_attempts",
      "step_executions",
      "review_finding_artifacts",
      "analysis_usage",
    ])
      expect(tables).not.toContain(retired);
    expect(tables).toContain("runs");
    expect(tables).toContain("pr_findings");
    expect(tables).toContain("cleanup_tasks");
  });
  for (let index = 0; index < 96; index++)
    expect(await ledger.reserveAnalysisToolCall(runId, 0, 1)).toBe(true);
  expect(await ledger.reserveAnalysisToolCall(runId, 0, 1)).toBe(false);
  expect(await ledger.runState(runId)).toBe("running");
});

it("migrates consumed budgets atomically without changing core rows and is replay safe", async () => {
  const { applyLedgerMigrations } =
    await import("../src/ledger/ledger-migrations.js");
  const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:9");
  const runId =
    `github:42:pr:9:head:${"a".repeat(40)}:base:${"b".repeat(40)}` as const;
  await ledger.claimRun(
    {
      id: runId,
      prKey: "github:42:pr:9",
      state: "queued",
      attempt: 0,
      createdAt: new Date().toISOString(),
      causalVersion: new Date().toISOString(),
    },
    "migration-upgrade",
  );
  await ledger.transition(
    runId,
    "queued",
    "running",
    new Date().toISOString(),
    "migration-upgrade:start",
  );
  await runInDurableObject(ledger, (_object, state) => {
    const sql = state.storage.sql;
    // Recreate the retired schema at the v16 boundary, with real consumed reservations.
    sql.exec(`DELETE FROM schema_migrations WHERE version=17;
      DROP TABLE review_tool_budgets;
      CREATE TABLE analysis_usage (run_id TEXT NOT NULL, event_id TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, tool_calls INTEGER NOT NULL, PRIMARY KEY(run_id,event_id));
      CREATE TABLE projection_tasks (run_id TEXT PRIMARY KEY);
      CREATE TABLE run_telemetry (run_id TEXT PRIMARY KEY);
      CREATE TABLE step_attempts (run_id TEXT PRIMARY KEY);
      CREATE TABLE step_executions (run_id TEXT PRIMARY KEY);
      CREATE TABLE review_finding_artifacts (run_id TEXT NOT NULL, part INTEGER NOT NULL, payload BLOB NOT NULL, PRIMARY KEY(run_id,part));
      ALTER TABLE run_configurations ADD COLUMN summary_json TEXT NOT NULL DEFAULT '{}';`);
    for (let call = 1; call <= 11; call++)
      sql.exec(
        "INSERT INTO analysis_usage VALUES (?,?,0,0,1)",
        runId,
        `tool:0:${call}`,
      );
    sql.exec(
      "INSERT INTO analysis_usage VALUES (?,?,0,0,1)",
      runId,
      "tool:12:1",
    );
    sql.exec(
      "INSERT INTO analysis_usage VALUES (?,?,100,20,0)",
      runId,
      "model:review",
    );
    sql.exec(
      "INSERT INTO run_configurations VALUES (?,?,?,?)",
      runId,
      "digest",
      "reference",
      "summary",
    );
    sql.exec(
      "INSERT INTO review_analysis_artifacts VALUES (?,0,?)",
      runId,
      new Uint8Array([1, 2, 3]).buffer,
    );
    const before = sql.exec("SELECT * FROM runs").toArray();
    // Fail at the last statement, after the copies and DROPs, to prove rollback.
    sql.exec(
      "ALTER TABLE run_configurations RENAME COLUMN summary_json TO missing_summary",
    );
    expect(() => applyLedgerMigrations(state.storage)).toThrow();
    expect(
      sql.exec("SELECT SUM(tool_calls) AS calls FROM analysis_usage").one()
        .calls,
    ).toBe(12);
    expect(
      sql
        .exec("SELECT version FROM schema_migrations WHERE version=17")
        .toArray(),
    ).toEqual([]);
    expect(
      sql
        .exec("SELECT name FROM sqlite_master WHERE name='review_tool_budgets'")
        .toArray(),
    ).toEqual([]);
    expect(
      sql.exec("SELECT * FROM review_finding_artifacts").toArray(),
    ).toEqual([]);
    sql.exec(
      "ALTER TABLE run_configurations RENAME COLUMN missing_summary TO summary_json",
    );
    applyLedgerMigrations(state.storage);
    applyLedgerMigrations(state.storage);
    expect(sql.exec("SELECT * FROM runs").toArray()).toEqual(before);
    expect(sql.exec("SELECT * FROM run_configurations").toArray()).toEqual([
      { run_id: runId, config_digest: "digest", reference_json: "reference" },
    ]);
    expect(
      sql.exec("SELECT payload FROM review_analysis_artifacts").one().payload,
    ).toEqual(new Uint8Array([1, 2, 3]).buffer);
    expect(
      sql
        .exec(
          "SELECT shard_index,calls FROM review_tool_budgets ORDER BY shard_index",
        )
        .toArray(),
    ).toEqual([
      { shard_index: 0, calls: 11 },
      { shard_index: 12, calls: 1 },
    ]);
    expect(
      sql
        .exec("PRAGMA table_info(run_configurations)")
        .toArray()
        .map((row) => row.name),
    ).not.toContain("summary_json");
  });
  for (let remaining = 0; remaining < 84; remaining++)
    expect(await ledger.reserveAnalysisToolCall(runId, 0, 13)).toBe(true);
  expect(await ledger.reserveAnalysisToolCall(runId, 0, 13)).toBe(false);
  expect(await ledger.reserveAnalysisToolCall(runId, 12, 13)).toBe(false);
});
