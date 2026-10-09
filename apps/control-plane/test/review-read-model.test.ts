import type { ReviewProjectionWriterPort } from "@holon/contracts/dashboard-reviews";
import type { ReviewRun } from "@holon/domain";
import {
  reset,
  runInDurableObject,
  applyD1Migrations,
  runDurableObjectAlarm,
  evictDurableObject,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const metadata = {
  installationId: 1,
  repositoryId: 42,
  pullRequestNumber: 7,
  title: "Synthetic",
  author: "synthetic",
  pullRequestState: "open",
  headSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  sourceUpdatedAt: "2026-10-09T00:00:00.000Z",
};
const run: ReviewRun = {
  id: `github:42:pr:7:head:${metadata.headSha}:base:${metadata.baseSha}`,
  prKey: "github:42:pr:7",
  state: "queued",
  attempt: 0,
  createdAt: metadata.sourceUpdatedAt,
  causalVersion: metadata.sourceUpdatedAt,
};
const database = env as unknown as {
  PROJECTION_DB: D1Database;
  PROJECTION_MIGRATIONS: D1Migration[];
};
beforeEach(() =>
  applyD1Migrations(database.PROJECTION_DB, database.PROJECTION_MIGRATIONS),
);
afterEach(() => reset());
it("preserves terminal transition atomicity for a ledger without projection metadata", async () => {
  const ledger = env.REVIEW_LEDGERS.getByName(run.prKey);
  await ledger.claimRun(run, "legacy-active");
  await ledger.transition(
    run.id,
    "queued",
    "running",
    metadata.sourceUpdatedAt,
    "start",
  );
  await ledger.transition(
    run.id,
    "running",
    "publishing",
    metadata.sourceUpdatedAt,
    "publish",
  );
  await runInDurableObject(ledger, async (object, state) => {
    state.storage.sql.exec(
      "CREATE TRIGGER fail_cleanup BEFORE INSERT ON cleanup_tasks BEGIN SELECT RAISE(ABORT,'synthetic_failure'); END",
    );
    await expect(
      object.transitionAndRequestCleanup(
        run.id,
        "publishing",
        "completed",
        metadata.sourceUpdatedAt,
        "complete",
      ),
    ).rejects.toThrow();
    expect(
      state.storage.sql
        .exec<{ state: string }>("SELECT state FROM runs WHERE id=?", run.id)
        .toArray()[0]?.state,
    ).toBe("publishing");
  });
});
it("commits metadata, state, revision, obligation and alarm together; duplicates and stale events do not advance activity", async () => {
  const ledger = env.REVIEW_LEDGERS.getByName(run.prKey);
  await ledger.observePullRequest(metadata);
  await ledger.claimRun(run, "synthetic-workflow");
  const response = await ledger.reviewDetail({
    ...metadataCoordinates(),
    cursor: null,
  });
  expect(response.status).toBe("available");
  if (response.status !== "available") throw new Error("missing detail");
  const detail = response.detail;
  expect(detail.review).toMatchObject({
    runId: run.id,
    state: "queued",
    snapshotRevision: 2,
    activityAt: metadata.sourceUpdatedAt,
  });
  await ledger.claimRun(run, "synthetic-workflow");
  await ledger.observePullRequest(metadata);
  await ledger.observePullRequest({
    ...metadata,
    title: "old",
    sourceUpdatedAt: "2026-10-08T00:00:00.000Z",
  });
  expect((await readDetail(ledger)).review).toEqual(detail.review);
  const pending = await runInDurableObject(ledger, async (_, state) => {
    const count = state.storage.sql
      .exec("SELECT * FROM review_projection_task")
      .toArray().length;
    if (count) expect(await state.storage.getAlarm()).not.toBeNull();
    return count;
  });
  if (!pending)
    expect(
      (
        await database.PROJECTION_DB.prepare(
          "SELECT snapshot_revision FROM review_projection WHERE installation_id=1 AND repository_id=42 AND pull_request_number=7",
        ).first<{ snapshot_revision: number }>()
      )?.snapshot_revision,
    ).toBe(detail.review.snapshotRevision);
  await ledger.transition(
    run.id,
    "queued",
    "running",
    "2026-10-09T01:00:00.000Z",
    "start",
  );
  expect((await readDetail(ledger)).review).toMatchObject({
    state: "running",
    snapshotRevision: 3,
  });
  expect(
    (
      await ledger.reviewDetail({
        ...metadataCoordinates(),
        installationId: 2,
        cursor: null,
      })
    ).status,
  ).toBe("unavailable");
});
it("quarantines equal-version conflicting metadata and clears it only with a causal successor", async () => {
  const ledger = env.REVIEW_LEDGERS.getByName(run.prKey);
  await ledger.observePullRequest(metadata);
  await ledger.claimRun(run, "conflict-retention");
  await ledger.transition(
    run.id,
    "queued",
    "running",
    metadata.sourceUpdatedAt,
    "start",
  );
  await ledger.saveReviewAnalysis(run.id, {
    activeFindings: [],
    findings: [],
    resolvedFindings: [],
    updatedTrackedFindings: [],
    summary: "Evidence must survive quarantine",
    output: { language: "en", detail: "concise", maxInlineComments: 40 },
    omissionReasons: [],
    scopeStatus: "complete",
    shardsAnalyzed: 1,
    totalShards: 1,
  });
  await ledger.observePullRequest({ ...metadata, title: "conflicting" });
  expect(
    (await ledger.reviewDetail({ ...metadataCoordinates(), cursor: null }))
      .status,
  ).toBe("revision_changed");
  await ledger.observePullRequest({
    ...metadata,
    title: "newer",
    sourceUpdatedAt: "2026-10-09T01:00:00.000Z",
  });
  expect((await readDetail(ledger)).review.title).toBe("newer");
  expect((await readDetail(ledger)).summary).toBe(
    "Evidence must survive quarantine",
  );
});
function metadataCoordinates() {
  return { installationId: 1, repositoryId: 42, pullRequestNumber: 7 };
}

async function readDetail(
  ledger: ReturnType<typeof env.REVIEW_LEDGERS.getByName>,
) {
  const result = await ledger.reviewDetail({
    ...metadataCoordinates(),
    cursor: null,
  });
  if (result.status !== "available") throw new Error(result.status);
  return result.detail;
}

it("returns all 200 long findings through bounded coherent pages after temporary evidence cleanup", async () => {
  const ledger = env.REVIEW_LEDGERS.getByName(run.prKey);
  await ledger.observePullRequest(metadata);
  await ledger.claimRun(run, "large-review");
  await ledger.transition(
    run.id,
    "queued",
    "running",
    metadata.sourceUpdatedAt,
    "start",
  );
  const findings = Array.from({ length: 200 }, (_, index) => ({
    confidence: 0.95,
    diagnostic: "D".repeat(2000),
    evidence: Array.from({ length: 4 }, () => ({
      excerpt: "E".repeat(1200),
      path: "src/file.ts",
      reason: "R".repeat(600),
      startLine: 1,
    })),
    location: { line: index + 1, path: "src/file.ts", side: "RIGHT" as const },
    severity: "high" as const,
    suggestion: "S".repeat(3000),
    fingerprint: `fp:${index.toString(16).padStart(64, "0")}` as const,
    evidenceFingerprint: index.toString(16).padStart(64, "0"),
    status: "new" as const,
  }));
  await ledger.saveReviewAnalysis(run.id, {
    activeFindings: findings,
    findings: [],
    resolvedFindings: [],
    updatedTrackedFindings: [],
    summary: "</script><script>hostile()</script>" + "T".repeat(15000),
    output: { language: "en", detail: "concise", maxInlineComments: 40 },
    omissionReasons: [],
    scopeStatus: "complete",
    shardsAnalyzed: 25,
    totalShards: 25,
  });
  await runInDurableObject(ledger, (_, state) =>
    state.storage.sql.exec("DELETE FROM review_analysis_artifacts").toArray(),
  );
  let cursor: string | null = null;
  const fingerprints: string[] = [];
  let oldCursor: string | null = null;
  do {
    const result = await ledger.reviewDetail({
      ...metadataCoordinates(),
      cursor,
    });
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("missing aggregate");
    expect(result.detail.findings).toHaveLength(10);
    expect(result.detail.totalFindings).toBe(200);
    expect(
      new TextEncoder().encode(JSON.stringify(result)).byteLength,
    ).toBeLessThan(1024 * 1024);
    expect(JSON.stringify(result)).not.toContain("effectivePolicyDigest");
    fingerprints.push(...result.detail.findings.map((x) => x.fingerprint));
    cursor = result.detail.nextCursor;
    oldCursor ??= cursor;
  } while (cursor);
  expect(fingerprints).toEqual(findings.map((x) => x.fingerprint));
  await ledger.observePullRequest({
    ...metadata,
    headSha: "c".repeat(40),
    sourceUpdatedAt: "2026-10-09T01:00:00.000Z",
  });
  expect(
    (await ledger.reviewDetail({ ...metadataCoordinates(), cursor: oldCursor }))
      .status,
  ).toBe("revision_changed");
  const next = await readDetail(ledger);
  expect(next.review.runId).toBeNull();
  expect(next.findings).toEqual([]);
});

it("prearms durable retries beyond seven writer failures and preserves independent cleanup", async () => {
  const ledger = env.REVIEW_LEDGERS.getByName(run.prKey);
  await runInDurableObject(ledger, async (object, state) => {
    const bindings = (
      object as unknown as {
        env: { REVIEW_PROJECTION: ReviewProjectionWriterPort };
      }
    ).env;
    const actual = bindings.REVIEW_PROJECTION;
    bindings.REVIEW_PROJECTION = {
      write: () => Promise.reject(new Error("synthetic outage")),
    };
    try {
      await object.observePullRequest(metadata);
      await object.claimRun(run, "outage");
      for (let index = 0; index < 7; index++) {
        state.storage.sql.exec(
          "UPDATE review_projection_task SET next_attempt_at=?",
          new Date().toISOString(),
        );
        await object.alarm();
        expect(
          state.storage.sql
            .exec<{ attempts: number }>(
              "SELECT attempts FROM review_projection_task",
            )
            .toArray()[0]?.attempts,
        ).toBeGreaterThanOrEqual(index + 1);
        expect(await state.storage.getAlarm()).not.toBeNull();
      }
      await object.markTerminalAndRequestCleanup(
        run.id,
        metadata.sourceUpdatedAt,
        true,
      );
      await object.alarm();
      expect(await object.cleanupState(run.id)).toMatchObject({
        state: "completed",
      });
      expect(
        state.storage.sql
          .exec("SELECT * FROM review_projection_task")
          .toArray(),
      ).toHaveLength(1);
    } finally {
      bindings.REVIEW_PROJECTION = actual;
    }
  });
  await evictDurableObject(ledger);
  await runInDurableObject(ledger, (_, state) =>
    state.storage.sql
      .exec(
        "UPDATE review_projection_task SET next_attempt_at=?",
        new Date().toISOString(),
      )
      .toArray(),
  );
  await runDurableObjectAlarm(ledger);
  await runInDurableObject(ledger, (_, state) =>
    expect(
      state.storage.sql.exec("SELECT * FROM review_projection_task").toArray(),
    ).toHaveLength(0),
  );
  expect(await ledger.runState(run.id)).toBe("failed_terminal");
});
it("lost acknowledgement retries idempotently; old acknowledgement cannot clear a newer obligation", async () => {
  const ledger = env.REVIEW_LEDGERS.getByName(run.prKey);
  await runInDurableObject(ledger, async (object, state) => {
    const bindings = (
        object as unknown as {
          env: { REVIEW_PROJECTION: ReviewProjectionWriterPort };
        }
      ).env,
      actual = bindings.REVIEW_PROJECTION;
    bindings.REVIEW_PROJECTION = {
      write: async (input) => {
        await actual.write(input);
        throw new Error("reply lost");
      },
    };
    try {
      await object.observePullRequest(metadata);
      state.storage.sql.exec(
        "UPDATE review_projection_task SET next_attempt_at=?",
        new Date().toISOString(),
      );
      await object.alarm();
      expect(
        state.storage.sql
          .exec("SELECT * FROM review_projection_task")
          .toArray(),
      ).toHaveLength(1);
    } finally {
      bindings.REVIEW_PROJECTION = actual;
    }
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>((resolve) => (entered = resolve)),
      held = new Promise<void>((resolve) => (release = resolve));
    bindings.REVIEW_PROJECTION = {
      write: async (input) => {
        entered();
        await held;
        return actual.write(input);
      },
    };
    try {
      state.storage.sql.exec(
        "UPDATE review_projection_task SET next_attempt_at=?",
        new Date().toISOString(),
      );
      const sending = object.alarm();
      await reached;
      await object.observePullRequest({
        ...metadata,
        title: "during delivery",
        sourceUpdatedAt: "2026-10-09T02:00:00.000Z",
      });
      release();
      await sending;
      const task = state.storage.sql
        .exec<{ revision: number }>(
          "SELECT revision FROM review_projection_task",
        )
        .toArray()[0];
      const current = await object.reviewDetail({
        ...metadataCoordinates(),
        cursor: null,
      });
      if (current.status !== "available") throw new Error(current.status);
      expect(task?.revision).toBe(current.detail.review.snapshotRevision);
    } finally {
      bindings.REVIEW_PROJECTION = actual;
      release();
    }
  });
});
it("rolls back the first metadata/revision/task if alarm creation fails", async () => {
  const ledger = env.REVIEW_LEDGERS.getByName(run.prKey);
  await runInDurableObject(ledger, async (object, state) => {
    const original = state.storage.setAlarm.bind(state.storage);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    state.storage.setAlarm = () =>
      Promise.reject(new Error("synthetic alarm failure"));
    try {
      await expect(object.observePullRequest(metadata)).rejects.toThrow(
        "synthetic alarm failure",
      );
    } finally {
      state.storage.setAlarm = original;
    }
    expect(
      state.storage.sql.exec("SELECT * FROM review_read_metadata").toArray(),
    ).toHaveLength(0);
    expect(
      state.storage.sql.exec("SELECT * FROM review_read_snapshot").toArray(),
    ).toHaveLength(0);
    expect(
      state.storage.sql.exec("SELECT * FROM review_projection_task").toArray(),
    ).toHaveLength(0);
    await object.observePullRequest(metadata);
    const signals = log.mock.calls
      .map(([line]) => JSON.parse(String(line)))
      .filter((event) => event.event === "dashboard.alarm_health");
    log.mockRestore();
    expect(signals).toContainEqual({
      event: "dashboard.alarm_health",
      code: 1,
    });
    expect(signals).toContainEqual({
      event: "dashboard.alarm_health",
      code: 0,
    });
    expect(signals.every((event) => Object.keys(event).length === 2)).toBe(
      true,
    );
  });
  await ledger.observePullRequest(metadata);
  await evictDurableObject(ledger);
  expect((await readDetail(ledger)).review.snapshotRevision).toBe(1);
});

it("fences a captured revision 100 after synthetic DO restore to 60 and restoring generation 1 and reopening generation 3", async () => {
  const ledger = env.REVIEW_LEDGERS.getByName(run.prKey);
  await runInDurableObject(ledger, async (object, state) => {
    const bindings = (
      object as unknown as {
        env: { REVIEW_PROJECTION: ReviewProjectionWriterPort };
      }
    ).env;
    const actual = bindings.REVIEW_PROJECTION as ReviewProjectionWriterPort & {
      beginRecovery(raw: unknown): Promise<number>;
      activateRecovery(raw: unknown): Promise<void>;
    };
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>((resolve) => (entered = resolve)),
      held = new Promise<void>((resolve) => (release = resolve));
    bindings.REVIEW_PROJECTION = {
      ...actual,
      write: async (input) => {
        entered();
        await held;
        return actual.write(input);
      },
    };
    try {
      await object.observePullRequest(metadata);
      const row = state.storage.sql
        .exec<{ payload: string }>("SELECT payload FROM review_read_snapshot")
        .toArray()[0]!;
      const snapshot = { ...JSON.parse(row.payload), snapshotRevision: 100 };
      state.storage.sql.exec(
        "UPDATE review_read_snapshot SET revision=100,generation=2,payload=?",
        JSON.stringify(snapshot),
      );
      state.storage.sql.exec(
        "UPDATE review_projection_task SET revision=100,generation=2,next_attempt_at=?",
        new Date().toISOString(),
      );
      await actual.write({ generation: 1, snapshot });
      await actual.beginRecovery({
        installationId: 1,
        repositoryId: 42,
        expectedGeneration: 1,
      });
      await actual.write({ generation: 2, snapshot });
      await actual.activateRecovery({
        installationId: 1,
        repositoryId: 42,
        expectedGeneration: 2,
      });
      const sending = object.alarm();
      await reached;
      expect(
        await actual.beginRecovery({
          installationId: 1,
          repositoryId: 42,
          expectedGeneration: 2,
        }),
      ).toBe(3);
      state.storage.sql.exec(
        "UPDATE review_read_snapshot SET revision=60,generation=1,payload=?",
        JSON.stringify({ ...snapshot, snapshotRevision: 60 }),
      );
      state.storage.sql.exec(
        "UPDATE review_projection_task SET revision=60,generation=1",
      );
      await object.resumeProjection({
        installationId: 1,
        repositoryId: 42,
        expectedGeneration: 1,
        generation: 3,
      });
      bindings.REVIEW_PROJECTION = actual;
      await object.alarm();
      await actual.activateRecovery({
        installationId: 1,
        repositoryId: 42,
        expectedGeneration: 3,
      });
      release();
      await sending;
      expect(
        state.storage.sql
          .exec("SELECT * FROM review_projection_task")
          .toArray(),
      ).toHaveLength(0);
    } finally {
      release();
      bindings.REVIEW_PROJECTION = actual;
    }
  });
  const row = await database.PROJECTION_DB.prepare(
    "SELECT generation,snapshot_revision FROM review_projection WHERE installation_id=1 AND repository_id=42 AND pull_request_number=7",
  ).first();
  expect(row).toEqual({ generation: 3, snapshot_revision: 60 });
});

it("changes observable retry state without promoting internal retry activity", async () => {
  const ledger = env.REVIEW_LEDGERS.getByName(run.prKey);
  await ledger.observePullRequest(metadata);
  await ledger.claimRun(run, "retry-activity");
  await ledger.transition(
    run.id,
    "queued",
    "running",
    "2026-10-09T01:00:00.000Z",
    "start",
  );
  const started = await readDetail(ledger);
  await ledger.transition(
    run.id,
    "running",
    "failed_retryable",
    "2026-10-09T02:00:00.000Z",
    "failure",
  );
  const retry = await readDetail(ledger);
  expect(retry.review.activityAt).toBe(started.review.activityAt);
  expect(retry.review.snapshotRevision).toBeGreaterThan(
    started.review.snapshotRevision,
  );
  await ledger.transition(
    run.id,
    "failed_retryable",
    "running",
    "2026-10-09T03:00:00.000Z",
    "retry",
  );
  expect((await readDetail(ledger)).review.activityAt).toBe(
    started.review.activityAt,
  );
});
it("accepts a causally newer replacement installation without changing PR identity", async () => {
  const ledger = env.REVIEW_LEDGERS.getByName(run.prKey);
  await ledger.observePullRequest(metadata);
  const before = await readDetail(ledger);
  await ledger.observePullRequest({
    ...metadata,
    installationId: 2,
    headSha: "c".repeat(40),
    sourceUpdatedAt: "2026-10-09T04:00:00.000Z",
  });
  const result = await ledger.reviewDetail({
    ...metadataCoordinates(),
    installationId: 2,
    cursor: null,
  });
  expect(result.status).toBe("available");
  if (result.status !== "available") throw new Error("new scope missing");
  expect(result.detail.review.snapshotRevision).toBeGreaterThan(
    before.review.snapshotRevision,
  );
  expect(
    (await ledger.reviewDetail({ ...metadataCoordinates(), cursor: null }))
      .status,
  ).toBe("unavailable");
  await ledger.observePullRequest({
    ...metadata,
    sourceUpdatedAt: "2026-10-09T03:00:00.000Z",
  });
  expect(
    await ledger.reviewDetail({
      ...metadataCoordinates(),
      installationId: 2,
      cursor: null,
    }),
  ).toEqual(result);
});
it("promotes final terminal failure after retries as meaningful activity", async () => {
  const ledger = env.REVIEW_LEDGERS.getByName(run.prKey);
  await ledger.observePullRequest(metadata);
  await ledger.claimRun(run, "terminal-activity");
  await ledger.transition(
    run.id,
    "queued",
    "running",
    metadata.sourceUpdatedAt,
    "start",
  );
  await ledger.transition(
    run.id,
    "running",
    "failed_retryable",
    "2026-10-09T04:00:00.000Z",
    "retryable",
  );
  await ledger.transition(
    run.id,
    "failed_retryable",
    "failed_terminal",
    "2026-10-09T05:00:00.000Z",
    "terminal",
  );
  expect((await readDetail(ledger)).review.activityAt).toBe(
    "2026-10-09T05:00:00.000Z",
  );
});
