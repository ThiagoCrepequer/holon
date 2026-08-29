import type { ClaimedPublication, ReviewLedger } from "@holon/application";
import {
  positiveIntegerSchema,
  publicationIdSchema,
  publicationRecordSchema,
  runClaimSchema,
  runIdSchema,
  runStateSchema,
  runTransitionSchema,
  timestampSchema,
} from "@holon/contracts";
import type {
  PublicationId,
  PublicationRecord,
  ReviewRun,
  RunId,
  RunState,
} from "@holon/domain";
import { canTransitionRun } from "@holon/domain";
import { DurableObject } from "cloudflare:workers";

interface PublicationRow extends Record<string, SqlStorageValue> {
  finding_id: string;
  github_comment_id: number | null;
  id: string;
  kind: string;
  marker: string;
  run_id: string;
  state: string;
}

function rowToPublication(row: PublicationRow): PublicationRecord {
  return publicationRecordSchema.parse({
    findingId: row.finding_id as PublicationRecord["findingId"],
    ...(row.github_comment_id === null
      ? {}
      : { githubCommentId: row.github_comment_id }),
    id: row.id as PublicationId,
    kind: row.kind as PublicationRecord["kind"],
    marker: row.marker,
    runId: row.run_id as RunId,
    state: row.state as PublicationRecord["state"],
  }) as unknown as PublicationRecord;
}

export class ReviewLedgerObject extends DurableObject implements ReviewLedger {
  public constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        pr_key TEXT NOT NULL,
        state TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        workflow_instance_id TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS publications (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        finding_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        marker TEXT NOT NULL,
        state TEXT NOT NULL,
        github_comment_id INTEGER
      );
      CREATE INDEX IF NOT EXISTS publications_run_id ON publications(run_id);
      CREATE TABLE IF NOT EXISTS transition_operations (
        operation_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        expected_state TEXT NOT NULL,
        next_state TEXT NOT NULL
      );
    `);
    const runColumns = this.ctx.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(runs)")
      .toArray();
    if (!runColumns.some((column) => column.name === "workflow_instance_id")) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE runs ADD COLUMN workflow_instance_id TEXT NOT NULL DEFAULT 'legacy'",
      );
    }
  }

  public claimRun(
    rawRun: ReviewRun,
    rawWorkflowInstanceId: string,
  ): Promise<"claimed" | "duplicate" | "resume"> {
    const { run, workflowInstanceId } = runClaimSchema.parse({
      run: rawRun,
      workflowInstanceId: rawWorkflowInstanceId,
    });
    const sql = this.ctx.storage.sql;
    const existing = sql
      .exec<{ id: string; state: string; workflow_instance_id: string }>(
        "SELECT id, state, workflow_instance_id FROM runs WHERE id = ?",
        run.id,
      )
      .toArray();
    if (existing[0] !== undefined) {
      const isOwnedActiveRun =
        existing[0].workflow_instance_id === workflowInstanceId &&
        !["completed", "obsolete", "failed_terminal"].includes(
          existing[0].state,
        );
      return Promise.resolve(isOwnedActiveRun ? "resume" : "duplicate");
    }
    this.ctx.storage.transactionSync(() => {
      sql.exec(
        "INSERT INTO runs (id, pr_key, state, attempt, created_at, workflow_instance_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        run.id,
        run.prKey,
        run.state,
        run.attempt,
        run.createdAt,
        workflowInstanceId,
        run.updatedAt ?? null,
      );
      sql.exec(
        "INSERT INTO metadata (key, value) VALUES ('latest_run_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        run.id,
      );
    });
    return Promise.resolve("claimed");
  }

  public isLatestRun(runId: RunId): Promise<boolean> {
    const parsedRunId = runIdSchema.parse(runId);
    const rows = this.ctx.storage.sql
      .exec<{ value: string }>(
        "SELECT value FROM metadata WHERE key = 'latest_run_id'",
      )
      .toArray();
    return Promise.resolve(rows[0]?.value === parsedRunId);
  }

  public runState(runId: RunId): RunState | undefined {
    const parsedRunId = runIdSchema.parse(runId);
    const row = this.ctx.storage.sql
      .exec<{ state: string }>(
        "SELECT state FROM runs WHERE id = ?",
        parsedRunId,
      )
      .toArray()[0];
    return row === undefined ? undefined : runStateSchema.parse(row.state);
  }

  public async transition(
    runId: RunId,
    expected: RunState,
    next: RunState,
    occurredAt: string,
    operationId: string,
  ): Promise<void> {
    const transition = runTransitionSchema.parse({
      expected,
      next,
      occurredAt,
      operationId,
      runId,
    });
    if (!canTransitionRun(expected, next))
      throw new TypeError(
        `Invalid review run transition: ${expected} -> ${next}`,
      );
    const sql = this.ctx.storage.sql;
    const recorded = sql
      .exec<{ expected_state: string; next_state: string; run_id: string }>(
        "SELECT run_id, expected_state, next_state FROM transition_operations WHERE operation_id = ?",
        transition.operationId,
      )
      .toArray()[0];
    if (recorded !== undefined) {
      if (
        recorded.run_id === transition.runId &&
        recorded.expected_state === transition.expected &&
        recorded.next_state === transition.next
      )
        return;
      throw new Error(
        "Transition operation id was reused with different input",
      );
    }
    this.ctx.storage.transactionSync(() => {
      const cursor = sql.exec(
        "UPDATE runs SET state = ?, updated_at = ?, attempt = attempt + ? WHERE id = ? AND state = ?",
        transition.next,
        transition.occurredAt,
        transition.next === "running" ? 1 : 0,
        transition.runId,
        transition.expected,
      );
      if (cursor.rowsWritten !== 1)
        throw new Error(
          `Conditional transition failed: ${transition.expected} -> ${transition.next}`,
        );
      sql.exec(
        "INSERT INTO transition_operations (operation_id, run_id, expected_state, next_state) VALUES (?, ?, ?, ?)",
        transition.operationId,
        transition.runId,
        transition.expected,
        transition.next,
      );
    });
  }

  public markRetryExhausted(runId: RunId, occurredAt: string): boolean {
    const parsedRunId = runIdSchema.parse(runId);
    const parsedOccurredAt = timestampSchema.parse(occurredAt);
    const cursor = this.ctx.storage.sql.exec(
      "UPDATE runs SET state = 'failed_terminal', updated_at = ? WHERE id = ? AND state = 'failed_retryable'",
      parsedOccurredAt,
      parsedRunId,
    );
    return cursor.rowsWritten === 1;
  }

  public markTerminal(runId: RunId, occurredAt: string): boolean {
    const parsedRunId = runIdSchema.parse(runId);
    const parsedOccurredAt = timestampSchema.parse(occurredAt);
    const cursor = this.ctx.storage.sql.exec(
      "UPDATE runs SET state = 'failed_terminal', updated_at = ? WHERE id = ? AND state IN ('queued', 'running', 'publishing', 'failed_retryable')",
      parsedOccurredAt,
      parsedRunId,
    );
    return cursor.rowsWritten === 1;
  }

  public claimPublication(
    rawRecord: PublicationRecord,
  ): Promise<ClaimedPublication> {
    publicationRecordSchema.parse(rawRecord);
    const record = rawRecord;
    const sql = this.ctx.storage.sql;
    const existing = sql
      .exec<PublicationRow>(
        "SELECT * FROM publications WHERE id = ?",
        record.id,
      )
      .toArray()[0];
    if (existing !== undefined) {
      const stored = rowToPublication(existing);
      return Promise.resolve({
        outcome: stored.state === "published" ? "published" : "reconcile",
        record: stored,
      });
    }
    sql.exec(
      "INSERT INTO publications (id, run_id, finding_id, kind, marker, state) VALUES (?, ?, ?, ?, ?, ?)",
      record.id,
      record.runId,
      record.findingId,
      record.kind,
      record.marker,
      record.state,
    );
    return Promise.resolve({ outcome: "claimed", record });
  }

  public async completePublication(
    rawId: PublicationId,
    rawGithubCommentId: number,
  ): Promise<void> {
    const id = publicationIdSchema.parse(rawId);
    const githubCommentId = positiveIntegerSchema.parse(rawGithubCommentId);
    const existing = this.ctx.storage.sql
      .exec<PublicationRow>("SELECT * FROM publications WHERE id = ?", id)
      .toArray()[0];
    if (
      existing?.state === "published" &&
      existing.github_comment_id === githubCommentId
    )
      return;
    const cursor = this.ctx.storage.sql.exec(
      "UPDATE publications SET state = 'published', github_comment_id = ? WHERE id = ? AND state = 'publishing'",
      githubCommentId,
      id,
    );
    if (cursor.rowsWritten !== 1)
      throw new Error("Publication was not in publishing state");
  }
}
