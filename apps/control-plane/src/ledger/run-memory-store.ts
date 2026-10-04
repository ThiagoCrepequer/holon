import {
  memoryDeliverySchema,
  memoryLimits,
  memorySnapshotSchema,
  runIdSchema,
  type MemoryDelivery,
  type MemoryObservation,
  type MemorySnapshot,
} from "@holon/contracts";
import { redactSecrets } from "@holon/domain";

export class RunMemoryStore {
  constructor(private readonly storage: DurableObjectStorage) {}
  load(runId: string): MemorySnapshot | undefined {
    runIdSchema.parse(runId);
    const row = this.storage.sql
      .exec<{ snapshot_json: string; expires_at: string }>(
        "SELECT snapshot_json,expires_at FROM run_memory_snapshots WHERE run_id=?",
        runId,
      )
      .toArray()[0];
    if (!row) {
      if (this.source(runId)) throw new Error("Run memory snapshot expired");
      return undefined;
    }
    if (Date.parse(row.expires_at) <= Date.now())
      throw new Error("Run memory snapshot expired");
    return memorySnapshotSchema.parse(JSON.parse(row.snapshot_json));
  }
  source(
    runId: string,
  ):
    | Pick<MemorySnapshot, "identity" | "memoryName" | "capturedAt">
    | undefined {
    const row = this.storage.sql
      .exec<{ source_json: string }>(
        "SELECT source_json FROM run_memory_sources WHERE run_id=?",
        runIdSchema.parse(runId),
      )
      .toArray()[0];
    if (!row) return undefined;
    const parsed = memorySnapshotSchema.parse({
      ...JSON.parse(row.source_json),
      revision: 0,
      expiresAt: new Date().toISOString(),
      rules: [],
      observations: [],
    });
    return {
      identity: parsed.identity,
      memoryName: parsed.memoryName,
      capturedAt: parsed.capturedAt,
    };
  }
  save(raw: MemorySnapshot): void {
    const snapshot = memorySnapshotSchema.parse(raw);
    if (
      new TextEncoder().encode(JSON.stringify(snapshot)).byteLength >
      memoryLimits.snapshotBytes
    )
      throw new Error("Memory snapshot budget exceeded");
    this.storage.transactionSync(() => {
      const existing = this.load(snapshot.identity.runId);
      if (existing && JSON.stringify(existing) !== JSON.stringify(snapshot))
        throw new Error("Run memory snapshot is sealed");
      const run = this.storage.sql
        .exec<{ state: string }>(
          "SELECT state FROM runs WHERE id=?",
          snapshot.identity.runId,
        )
        .toArray()[0];
      if (!run || !["running", "publishing"].includes(run.state))
        throw new Error("Run memory unavailable");
      this.storage.sql.exec(
        "INSERT OR IGNORE INTO run_memory_sources VALUES(?,?)",
        snapshot.identity.runId,
        JSON.stringify({
          identity: snapshot.identity,
          memoryName: snapshot.memoryName,
          capturedAt: snapshot.capturedAt,
        }),
      );
      this.storage.sql.exec(
        "INSERT OR IGNORE INTO run_memory_snapshots VALUES(?,?,?)",
        snapshot.identity.runId,
        snapshot.expiresAt,
        JSON.stringify(snapshot),
      );
    });
  }
  enqueue(
    snapshot: Pick<MemorySnapshot, "identity" | "memoryName">,
    raw: Omit<MemoryObservation, "source">,
  ): void {
    const observation = {
      ...raw,
      summary: redactSecrets(raw.summary),
      ...(raw.feedbackReason
        ? { feedbackReason: redactSecrets(raw.feedbackReason) }
        : {}),
      source: snapshot.identity,
    };
    const delivery = memoryDeliverySchema.parse({
      memoryName: snapshot.memoryName,
      observation,
    });
    this.storage.sql.exec(
      "INSERT OR IGNORE INTO memory_outbox(id,delivery_json,next_attempt_at) VALUES(?,?,?)",
      observation.id,
      JSON.stringify(delivery),
      new Date(Date.now() + 1000).toISOString(),
    );
  }
  due(): Array<{ id: string; delivery: MemoryDelivery; attempts: number }> {
    return this.storage.sql
      .exec<{ id: string; delivery_json: string; attempts: number }>(
        "SELECT id,delivery_json,attempts FROM memory_outbox WHERE next_attempt_at<=? ORDER BY next_attempt_at,id LIMIT 25",
        new Date().toISOString(),
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        attempts: row.attempts,
        delivery: memoryDeliverySchema.parse(JSON.parse(row.delivery_json)),
      }));
  }
  complete(id: string): void {
    this.storage.sql.exec("DELETE FROM memory_outbox WHERE id=?", id);
  }
  retry(id: string, attempts: number): void {
    this.storage.sql.exec(
      "UPDATE memory_outbox SET attempts=?,next_attempt_at=? WHERE id=?",
      attempts,
      new Date(
        Date.now() + Math.min(3_600_000, 5000 * 2 ** Math.min(attempts, 9)),
      ).toISOString(),
      id,
    );
  }
}
