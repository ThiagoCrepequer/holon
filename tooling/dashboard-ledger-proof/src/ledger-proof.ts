import { DurableObject } from "cloudflare:workers";

export const retryDelay = 1000;
export type TaskKind = "projection" | "cleanup" | "checks" | "supersession";
export type AtomicFault =
  | "none"
  | "before-alarm"
  | "after-alarm"
  | "after-commit";
export interface TaskSnapshot {
  kind: TaskKind;
  target_revision: number;
  attempts: number;
  payload: string;
}
interface TaskRow extends Record<string, SqlStorageValue> {
  kind: TaskKind;
  target_revision: number;
  due_at: number;
  attempts: number;
}
interface LedgerRow extends Record<string, SqlStorageValue> {
  revision: number;
  payload: string;
}

// Isolated runtime proof. Fault hooks and effect port never enter the core Worker.
export class ProofLedger extends DurableObject {
  public abortClaimTransaction = false;
  public effect: (task: TaskSnapshot) => Promise<void> = () =>
    Promise.reject(new Error("unconfigured-test-effect"));

  public constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL);
      INSERT OR IGNORE INTO ledger VALUES(1,0,'');
      CREATE TABLE IF NOT EXISTS task_versions (kind TEXT PRIMARY KEY, revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (kind TEXT PRIMARY KEY, target_revision INTEGER NOT NULL, due_at INTEGER NOT NULL, attempts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS outcomes (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, target_revision INTEGER NOT NULL, result TEXT NOT NULL);
    `);
    // The constructor deliberately does not manufacture a missing wake-up.
  }

  public async mutateAtomic(
    payload: string,
    dueAt: number,
    fault: AtomicFault = "none",
  ): Promise<void> {
    await this.ctx.storage.transaction(async () => {
      this.writeMutation(payload, dueAt);
      if (fault === "before-alarm") throw new Error("injected-before-alarm");
      await this.armEarliest();
      if (fault === "after-alarm") throw new Error("injected-after-alarm");
    });
    if (fault === "after-commit") throw new Error("injected-after-commit");
  }

  public async mutateSplitSync(
    payload: string,
    dueAt: number,
    fault: "none" | "inside-sql" | "before-alarm" = "none",
  ): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      this.writeMutation(payload, dueAt);
      if (fault === "inside-sql") throw new Error("injected-inside-sql");
    });
    if (fault === "before-alarm") throw new Error("injected-sync-before-alarm");
    await this.armEarliest();
  }

  public async scheduleMaintenance(
    kind: Exclude<TaskKind, "projection">,
    dueAt: number,
  ): Promise<void> {
    await this.ctx.storage.transaction(async () => {
      const revision = this.ctx.storage.sql
        .exec<{ revision: number }>(
          "INSERT INTO task_versions(kind,revision) VALUES(?,1) ON CONFLICT(kind) DO UPDATE SET revision=revision+1 RETURNING revision",
          kind,
        )
        .one().revision;
      this.ctx.storage.sql.exec(
        "INSERT INTO tasks VALUES(?,?,?,0) ON CONFLICT(kind) DO UPDATE SET target_revision=excluded.target_revision,due_at=MIN(tasks.due_at,excluded.due_at)",
        kind,
        revision,
        dueAt,
      );
      await this.armEarliest();
    });
  }

  public override async alarm(): Promise<void> {
    const now = Date.now();
    const due = await this.ctx.storage.transaction(async () => {
      const tasks = this.ctx.storage.sql
        .exec<TaskRow>(
          "SELECT kind,target_revision,due_at,attempts FROM tasks WHERE due_at<=? ORDER BY kind",
          now,
        )
        .toArray();
      const current = this.ctx.storage.sql
        .exec<LedgerRow>("SELECT revision,payload FROM ledger")
        .one();
      const snapshots: TaskSnapshot[] = [];
      for (const task of tasks) {
        const attempts = task.attempts + 1;
        this.ctx.storage.sql.exec(
          "UPDATE tasks SET attempts=?,due_at=? WHERE kind=?",
          attempts,
          now + retryDelay,
          task.kind,
        );
        snapshots.push({
          kind: task.kind,
          target_revision: task.target_revision,
          attempts,
          payload: current.payload,
        });
      }
      // Commit a future wake-up before crossing the external effect boundary.
      await this.armEarliest();
      if (this.abortClaimTransaction)
        throw new Error("injected-claim-transaction-abort");
      return snapshots;
    });
    for (const task of due) {
      try {
        await this.effect(task);
      } catch {
        this.ctx.storage.sql.exec(
          "INSERT INTO outcomes(kind,target_revision,result) VALUES(?,?,'failed')",
          task.kind,
          task.target_revision,
        );
        continue;
      }
      await this.ctx.storage.transaction(async () => {
        // A late acknowledgement cannot delete a new desired revision/attempt.
        this.ctx.storage.sql.exec(
          "DELETE FROM tasks WHERE kind=? AND target_revision=? AND attempts=?",
          task.kind,
          task.target_revision,
          task.attempts,
        );
        this.ctx.storage.sql.exec(
          "INSERT INTO outcomes(kind,target_revision,result) VALUES(?,?,'succeeded')",
          task.kind,
          task.target_revision,
        );
        await this.armEarliest();
      });
    }
    await this.ctx.storage.transaction(() => this.armEarliest());
  }

  private writeMutation(payload: string, dueAt: number): void {
    const revision = this.ctx.storage.sql
      .exec<{ revision: number }>(
        "UPDATE ledger SET revision=revision+1,payload=? WHERE id=1 RETURNING revision",
        payload,
      )
      .one().revision;
    this.ctx.storage.sql.exec(
      "INSERT INTO tasks VALUES('projection',?,?,0) ON CONFLICT(kind) DO UPDATE SET target_revision=excluded.target_revision,due_at=MIN(tasks.due_at,excluded.due_at)",
      revision,
      dueAt,
    );
  }

  private async armEarliest(): Promise<void> {
    const due = this.ctx.storage.sql
      .exec<{ due_at: number | null }>(
        "SELECT MIN(due_at) AS due_at FROM tasks",
      )
      .one().due_at;
    if (due === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(due);
  }
}
