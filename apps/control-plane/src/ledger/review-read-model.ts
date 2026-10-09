import {
  reviewFindingSchema,
  type ReconciledReviewOutput,
} from "@holon/contracts";
import {
  coreReviewDetailInputSchema,
  privateReviewDetailSchema,
  privateReviewSummarySchema,
  pullRequestMetadataSchema,
  projectionWriteSchema,
  resumeProjectionSchema,
  type PrivateReviewSummary,
  type PullRequestMetadata,
} from "@holon/contracts/dashboard-reviews";

import { FindingLedgerStore } from "./finding-ledger-store.js";

interface SnapshotRow extends Record<string, SqlStorageValue> {
  revision: number;
  generation: number;
  signature: string;
  payload: string;
}
export class ReviewReadModel {
  constructor(private readonly storage: DurableObjectStorage) {}
  observe(raw: unknown): string {
    const input = pullRequestMetadataSchema.parse(raw);
    input.sourceUpdatedAt = new Date(input.sourceUpdatedAt).toISOString();
    const row = this.storage.sql
      .exec<{ payload: string; conflicted: number }>(
        "SELECT payload,conflicted FROM review_read_metadata WHERE singleton=1",
      )
      .toArray()[0];
    if (row) {
      const previous = pullRequestMetadataSchema.parse(JSON.parse(row.payload));
      if (
        previous.repositoryId !== input.repositoryId ||
        previous.pullRequestNumber !== input.pullRequestNumber
      )
        throw new Error("review_scope_mismatch");
      if (input.sourceUpdatedAt < previous.sourceUpdatedAt) return "stale";
      if (input.sourceUpdatedAt === previous.sourceUpdatedAt) {
        if (JSON.stringify(previous) === JSON.stringify(input))
          return "duplicate";
        this.storage.sql.exec(
          "UPDATE review_read_metadata SET conflicted=1 WHERE singleton=1",
        );
        return "conflict";
      }
    }
    this.storage.sql.exec(
      "INSERT INTO review_read_metadata VALUES(1,?,0) ON CONFLICT(singleton) DO UPDATE SET payload=excluded.payload,conflicted=0",
      JSON.stringify(input),
    );
    return "applied";
  }
  private metadata():
    | { value: PullRequestMetadata; conflicted: boolean }
    | undefined {
    const row = this.storage.sql
      .exec<{ payload: string; conflicted: number }>(
        "SELECT payload,conflicted FROM review_read_metadata WHERE singleton=1",
      )
      .toArray()[0];
    return row
      ? {
          value: pullRequestMetadataSchema.parse(JSON.parse(row.payload)),
          conflicted: row.conflicted === 1,
        }
      : undefined;
  }
  private row(): SnapshotRow | undefined {
    return this.storage.sql
      .exec<SnapshotRow>("SELECT * FROM review_read_snapshot WHERE singleton=1")
      .toArray()[0];
  }
  generation(): number {
    return this.row()?.generation ?? 1;
  }
  snapshot(): PrivateReviewSummary | undefined {
    const row = this.row();
    return row
      ? privateReviewSummarySchema.parse(JSON.parse(row.payload))
      : undefined;
  }
  /** Only allowlisted evidence survives temporary analysis cleanup. Parts are below the SQL row limit. */
  saveDetail(runId: string, output: ReconciledReviewOutput): void {
    if (
      this.storage.sql
        .exec(
          "SELECT 1 FROM private_review_detail WHERE run_id=? LIMIT 1",
          runId,
        )
        .toArray().length
    )
      return;
    this.storage.sql.exec(
      "INSERT INTO private_review_detail VALUES(?,0,?)",
      runId,
      JSON.stringify({ summary: output.summary }),
    );
    for (const [index, finding] of output.activeFindings.entries()) {
      const value = reviewFindingSchema.parse({
        confidence: finding.confidence,
        diagnostic: finding.diagnostic,
        evidence: finding.evidence,
        location: finding.location,
        severity: finding.severity,
        suggestion: finding.suggestion,
      });
      this.storage.sql.exec(
        "INSERT INTO private_review_detail VALUES(?,?,?)",
        runId,
        index + 1,
        JSON.stringify({
          ...value,
          fingerprint: finding.fingerprint,
          status: finding.status,
        }),
      );
    }
  }
  private aggregate(review: PrivateReviewSummary, offset?: number) {
    const rows = review.runId
      ? this.storage.sql
          .exec<{ part: number; payload: string }>(
            "SELECT part,payload FROM private_review_detail WHERE run_id=? AND (? IS NULL OR part=0 OR (part>? AND part<=?)) ORDER BY part",
            review.runId,
            offset ?? null,
            offset ?? null,
            offset === undefined ? null : offset + 10,
          )
          .toArray()
      : [];
    const prKey =
      `github:${review.repositoryId}:pr:${review.pullRequestNumber}` as const;
    const tracked = new Map<
      string,
      ReturnType<FindingLedgerStore["loadPrFindings"]>[number]
    >(
      new FindingLedgerStore(this.storage)
        .loadPrFindings(prKey)
        .map((x) => [x.fingerprint, x]),
    );
    const findings = rows
      .filter((x) => x.part > 0)
      .map((x) => {
        const value = JSON.parse(x.payload) as PrivateReviewDetailFinding;
        const current = tracked.get(value.fingerprint);
        return {
          ...value,
          ...(current && current.lastSeenRunId === review.runId
            ? { status: current.status, diagnostic: current.diagnostic }
            : {}),
        };
      });
    const summary =
      rows[0]?.part === 0
        ? (JSON.parse(rows[0].payload) as { summary: string }).summary
        : null;
    return { summary, findings };
  }
  /** Called inside the same transaction as domain mutation and alarm creation. All SQL is captured before hashing. */
  async touch(occurredAt: string): Promise<void> {
    const metadata = this.metadata();
    if (!metadata) return;
    const { sourceUpdatedAt, ...fields } = metadata.value;
    const run = this.storage.sql
      .exec<{
        id: string;
        state: string;
        read_head_sha: string | null;
        read_base_sha: string | null;
      }>(
        "SELECT id,state,read_head_sha,read_base_sha FROM runs WHERE id=(SELECT value FROM metadata WHERE key='latest_run_id')",
      )
      .toArray()[0];
    const matched =
      run?.read_head_sha === fields.headSha &&
      run.read_base_sha === fields.baseSha &&
      !metadata.conflicted;
    const previous = this.row();
    const review = privateReviewSummarySchema.parse({
      ...fields,
      runId: matched ? run.id : null,
      state: metadata.conflicted
        ? "metadata_conflict"
        : matched
          ? run.state
          : "awaiting_review",
      snapshotRevision: (previous?.revision ?? 0) + 1,
      activityAt: sourceUpdatedAt,
      observedAt: new Date().toISOString(),
    });
    const aggregate = this.aggregate(review);
    const {
      snapshotRevision: _revision,
      activityAt: _activity,
      observedAt: _observed,
      ...identity
    } = review;
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify({ identity, ...aggregate })),
    );
    const signature = Array.from(new Uint8Array(bytes), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    if (previous?.signature === signature) return;
    const previousSnapshot = previous
      ? privateReviewSummarySchema.parse(JSON.parse(previous.payload))
      : undefined;
    review.activityAt = [
      sourceUpdatedAt,
      new Date(occurredAt).toISOString(),
      previousSnapshot?.activityAt ?? sourceUpdatedAt,
    ]
      .toSorted()
      .at(-1)!;
    const generation =
      previousSnapshot?.installationId === fields.installationId
        ? (previous?.generation ?? 1)
        : 1;
    this.storage.sql.exec(
      "INSERT INTO review_read_snapshot VALUES(1,?,?,?,?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision,generation=excluded.generation,signature=excluded.signature,payload=excluded.payload",
      review.snapshotRevision,
      generation,
      signature,
      JSON.stringify(review),
    );
    this.storage.sql.exec(
      "INSERT INTO review_projection_task VALUES(1,?,?,0,?) ON CONFLICT(singleton) DO UPDATE SET generation=excluded.generation,revision=excluded.revision,attempts=0,next_attempt_at=excluded.next_attempt_at",
      generation,
      review.snapshotRevision,
      new Date().toISOString(),
    );
    // A new current head owns a new aggregate; no historical dashboard retention/backfill.
    if (!metadata.conflicted)
      this.storage.sql.exec(
        "DELETE FROM private_review_detail WHERE run_id<>?",
        review.runId ?? "",
      );
  }
  detail(raw: unknown) {
    const input = coreReviewDetailInputSchema.parse(raw),
      review = this.snapshot();
    if (
      !review ||
      review.installationId !== input.installationId ||
      review.repositoryId !== input.repositoryId ||
      review.pullRequestNumber !== input.pullRequestNumber
    )
      throw new Error("review_unavailable");
    if (review.state === "metadata_conflict")
      throw new Error("review_revision_changed");
    const generation = this.row()!.generation;
    let offset = 0;
    if (input.cursor) {
      const match = /^(\d+):(\d+):(\d+):(\d+):(\d+):(\d+)$/u.exec(input.cursor);
      if (
        !match ||
        Number(match[1]) !== input.installationId ||
        Number(match[2]) !== input.repositoryId ||
        Number(match[3]) !== input.pullRequestNumber ||
        Number(match[4]) !== generation ||
        Number(match[5]) !== review.snapshotRevision ||
        !Number.isSafeInteger(Number(match[6]))
      )
        throw new Error("review_revision_changed");
      offset = Number(match[6]);
    }
    const totalFindings = review.runId
      ? (this.storage.sql
          .exec<{ total: number }>(
            "SELECT count(*) AS total FROM private_review_detail WHERE run_id=? AND part>0",
            review.runId,
          )
          .toArray()[0]?.total ?? 0)
      : 0;
    const aggregate = this.aggregate(review, offset);
    if (offset > totalFindings || offset % 10 !== 0)
      throw new Error("invalid_review_cursor");
    return privateReviewDetailSchema.parse({
      review,
      summary: aggregate.summary,
      findings: aggregate.findings,
      totalFindings,
      nextCursor:
        offset + 10 < totalFindings
          ? `${input.installationId}:${input.repositoryId}:${input.pullRequestNumber}:${generation}:${review.snapshotRevision}:${offset + 10}`
          : null,
    });
  }
  claim(now: number) {
    const task = this.storage.sql
      .exec<{
        generation: number;
        revision: number;
        attempts: number;
        next_attempt_at: string;
      }>(
        "SELECT * FROM review_projection_task WHERE singleton=1 AND next_attempt_at<=?",
        new Date(now).toISOString(),
      )
      .toArray()[0];
    if (!task) return undefined;
    const row = this.row();
    if (
      !row ||
      row.revision !== task.revision ||
      row.generation !== task.generation
    )
      throw new Error("projection_task_corrupt");
    const attempt = task.attempts + 1;
    this.storage.sql.exec(
      "UPDATE review_projection_task SET attempts=?,next_attempt_at=? WHERE singleton=1",
      attempt,
      new Date(
        now + Math.min(3600000, 5000 * 2 ** Math.min(attempt - 1, 10)),
      ).toISOString(),
    );
    return {
      attempt,
      input: projectionWriteSchema.parse({
        generation: row.generation,
        snapshot: JSON.parse(row.payload),
      }),
    };
  }
  acknowledge(generation: number, revision: number, attempt: number): void {
    this.storage.sql.exec(
      "DELETE FROM review_projection_task WHERE singleton=1 AND generation=? AND revision=? AND attempts=?",
      generation,
      revision,
      attempt,
    );
  }
  resume(raw: unknown): void {
    const input = resumeProjectionSchema.parse(raw),
      review = this.snapshot();
    if (
      !review ||
      review.installationId !== input.installationId ||
      review.repositoryId !== input.repositoryId ||
      this.row()?.generation !== input.expectedGeneration
    )
      throw new Error("recovery_conflict");
    this.storage.sql.exec(
      "UPDATE review_read_snapshot SET generation=? WHERE singleton=1",
      input.generation,
    );
    this.storage.sql.exec(
      "INSERT INTO review_projection_task VALUES(1,?,?,0,?) ON CONFLICT(singleton) DO UPDATE SET generation=excluded.generation,revision=excluded.revision,attempts=0,next_attempt_at=excluded.next_attempt_at",
      input.generation,
      review.snapshotRevision,
      new Date().toISOString(),
    );
  }
}
// Parsed again through the public contract before RPC; this intermediate value never escapes.
type PrivateReviewDetailFinding = {
  confidence: number;
  diagnostic: string;
  evidence: unknown[];
  location: unknown;
  severity: string;
  suggestion?: unknown;
  fingerprint: string;
  status: string;
};
