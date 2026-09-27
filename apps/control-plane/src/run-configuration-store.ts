import {
  configurationReference,
  sanitizedConfigurationSummary,
  verifyConfigurationSnapshot,
  RepositoryConfigurationError,
} from "@holon/application";
import {
  repositoryConfigLimits,
  runConfigurationSummarySchema,
  runConfigurationRefSchema,
  runConfigurationSnapshotSchema,
  type RunConfigurationRef,
  type RunConfigurationSnapshot,
} from "@holon/contracts";

/** PR-local private artifacts. Metadata survives cleanup; instruction bodies do not. */
export class RunConfigurationStore {
  constructor(private readonly storage: DurableObjectStorage) {}
  async save(raw: RunConfigurationSnapshot): Promise<RunConfigurationRef> {
    const snapshot = runConfigurationSnapshotSchema.parse(raw);
    const reference = configurationReference(snapshot);
    await verifyConfigurationSnapshot(snapshot, reference);
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
    if (bytes.byteLength > repositoryConfigLimits.serializedBytes)
      throw new RepositoryConfigurationError("budget_exceeded", "snapshot");
    return this.storage.transactionSync(() => {
      const existing = this.storage.sql
        .exec<{ config_digest: string; reference_json: string }>(
          "SELECT config_digest, reference_json FROM run_configurations WHERE run_id = ?",
          snapshot.identity.runId,
        )
        .toArray()[0];
      if (existing !== undefined) {
        if (
          existing.config_digest !== snapshot.configDigest ||
          existing.reference_json !== JSON.stringify(reference)
        )
          throw new RepositoryConfigurationError("snapshot_conflict");
        return runConfigurationRefSchema.parse(
          JSON.parse(existing.reference_json),
        );
      }
      const run = this.storage.sql
        .exec<{ state: string; pr_key: string }>(
          "SELECT state, pr_key FROM runs WHERE id = ?",
          snapshot.identity.runId,
        )
        .toArray()[0];
      if (
        run?.state !== "running" ||
        run.pr_key !==
          `github:${snapshot.identity.repositoryId}:pr:${snapshot.identity.pullRequestNumber}` ||
        snapshot.identity.runId !==
          `${run.pr_key}:head:${snapshot.identity.headSha}:base:${snapshot.identity.baseSha}`
      )
        throw new RepositoryConfigurationError("run_unavailable");
      this.storage.sql.exec(
        "INSERT INTO run_configurations(run_id, config_digest, reference_json, summary_json) VALUES (?, ?, ?, ?)",
        snapshot.identity.runId,
        snapshot.configDigest,
        JSON.stringify(reference),
        JSON.stringify(sanitizedConfigurationSummary(snapshot)),
      );
      for (let offset = 0; offset < bytes.length; offset += 64_000)
        this.storage.sql.exec(
          "INSERT INTO run_configuration_artifacts(run_id, part, payload) VALUES (?, ?, ?)",
          snapshot.identity.runId,
          offset / 64_000,
          bytes.slice(offset, offset + 64_000).buffer,
        );
      return reference;
    });
  }
  async load(raw: RunConfigurationRef): Promise<RunConfigurationSnapshot> {
    const reference = runConfigurationRefSchema.parse(raw);
    const rows = this.storage.sql
      .exec<{ part: number; payload: ArrayBuffer }>(
        "SELECT part, payload FROM run_configuration_artifacts WHERE run_id = ? ORDER BY part",
        reference.identity.runId,
      )
      .toArray();
    if (
      !rows.length ||
      rows.some((row, index) => row.part !== index) ||
      rows.reduce((sum, row) => sum + row.payload.byteLength, 0) >
        repositoryConfigLimits.serializedBytes
    )
      throw new RepositoryConfigurationError("snapshot_unavailable");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let snapshot: RunConfigurationSnapshot;
    try {
      snapshot = runConfigurationSnapshotSchema.parse(
        JSON.parse(
          rows
            .map((row) => decoder.decode(row.payload, { stream: true }))
            .join("") + decoder.decode(),
        ),
      );
    } catch {
      throw new RepositoryConfigurationError("snapshot_corrupt");
    }
    await verifyConfigurationSnapshot(snapshot, reference);
    return snapshot;
  }
  reference(runId: string): RunConfigurationRef | undefined {
    const row = this.storage.sql
      .exec<{ reference_json: string }>(
        "SELECT reference_json FROM run_configurations WHERE run_id = ?",
        runId,
      )
      .toArray()[0];
    return row === undefined
      ? undefined
      : runConfigurationRefSchema.parse(JSON.parse(row.reference_json));
  }
  summary(runId: string) {
    const row = this.storage.sql
      .exec<{ summary_json: string }>(
        "SELECT summary_json FROM run_configurations WHERE run_id = ?",
        runId,
      )
      .toArray()[0];
    return row === undefined
      ? null
      : runConfigurationSummarySchema.parse(JSON.parse(row.summary_json));
  }
  cleanup(runId: string): void {
    this.storage.sql.exec(
      "DELETE FROM run_configuration_artifacts WHERE run_id = ?",
      runId,
    );
  }
}
