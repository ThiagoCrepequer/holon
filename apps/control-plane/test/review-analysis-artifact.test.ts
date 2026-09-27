import {
  buildReviewAnalysisCheckpoint,
  type ReconciledReviewOutput,
} from "@holon/contracts";
import {
  reset,
  evictDurableObject,
  runInDurableObject,
  runDurableObjectAlarm,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it } from "vitest";
afterEach(() => reset());
const runId = `github:42:pr:7:head:${"a".repeat(40)}` as const;
it("retains usage and completed attempt timings across replay and eviction", async () => {
  const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
  await ledger.claimRun(
    {
      causalVersion: new Date().toISOString(),
      id: runId,
      prKey: "github:42:pr:7",
      createdAt: new Date().toISOString(),
      state: "queued",
      attempt: 0,
    },
    "usage-test",
  );
  await ledger.recordAnalysisUsage(runId, "call-one", {
    inputTokens: 100,
    outputTokens: 20,
    toolCallsCount: 2,
  });
  await ledger.recordAnalysisUsage(runId, "call-one", {
    inputTokens: 100,
    outputTokens: 20,
    toolCallsCount: 2,
  });
  await ledger.recordAnalysisUsage(runId, "call-two", {
    inputTokens: 50,
    outputTokens: 10,
    toolCallsCount: 1,
  });
  await ledger.recordStepAttemptComplete(
    runId,
    "analyze-shard-1",
    1,
    new Date().toISOString(),
    42,
  );
  await evictDurableObject(ledger);
  await expect(ledger.loadAnalysisAccounting(runId)).resolves.toMatchObject({
    inputTokens: 150,
    outputTokens: 30,
    toolCallsCount: 3,
    stepTimings: [
      {
        stepName: "analyze-shard-1",
        attempt: 1,
        durationMs: 42,
        status: "success",
      },
    ],
  });
});
it("checkpoints only a small manifest and round-trips large review evidence after eviction", async () => {
  const findings = Array.from({ length: 40 }, (_, i) => ({
    evidenceFingerprint: i.toString(16).padStart(64, "0"),
    fingerprint: `fp:${i.toString(16).padStart(64, "0")}` as const,
    status: "new" as const,
    confidence: 0.95,
    diagnostic: "d".repeat(2000),
    suggestion: "s".repeat(3000),
    severity: "high" as const,
    location: { path: `src/file${i}.ts`, line: 1, side: "RIGHT" as const },
    evidence: Array.from({ length: 4 }, () => ({
      path: `src/file${i}.ts`,
      startLine: 1,
      excerpt: "語".repeat(1200),
      reason: "r".repeat(600),
    })),
  }));
  const output: ReconciledReviewOutput = {
    activeFindings: findings,
    findings: findings.map(
      ({ fingerprint: _f, evidenceFingerprint: _e, status: _s, ...f }) => f,
    ),
    resolvedFindings: [],
    updatedTrackedFindings: [],
    omissionReasons: [],
    scopeStatus: "complete",
    shardsAnalyzed: 5,
    totalShards: 5,
    summary: "Large verified review.",
    verdict: "REQUEST_CHANGES",
  };
  expect(
    new TextEncoder().encode(JSON.stringify(output)).byteLength,
  ).toBeGreaterThan(1048576);
  expect(
    new TextEncoder().encode(
      JSON.stringify(buildReviewAnalysisCheckpoint(output)),
    ).byteLength,
  ).toBeLessThan(64000);
  const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
  await ledger.claimRun(
    {
      causalVersion: new Date().toISOString(),
      id: runId,
      prKey: "github:42:pr:7",
      createdAt: new Date().toISOString(),
      state: "queued",
      attempt: 0,
    },
    "artifact-test",
  );
  await ledger.transition(
    runId,
    "queued",
    "running",
    new Date().toISOString(),
    "artifact-start",
  );
  await ledger.saveReviewAnalysis(runId, output);
  await evictDurableObject(ledger);
  await expect(ledger.loadReviewAnalysis(runId)).resolves.toEqual(output);
  await runInDurableObject(ledger, (_object, state) => {
    const rows = state.storage.sql
      .exec<{ bytes: number }>(
        "SELECT length(payload) AS bytes FROM review_analysis_artifacts",
      )
      .toArray();
    expect(rows.length).toBeGreaterThan(1);
    expect(Math.max(...rows.map((row) => row.bytes))).toBeLessThanOrEqual(
      64000,
    );
  });
  await ledger.markTerminalAndRequestCleanup(
    runId,
    new Date().toISOString(),
    true,
  );
  await runDurableObjectAlarm(ledger);
  await expect
    .poll(async () => (await ledger.cleanupState(runId))?.state)
    .toBe("completed");
  await runInDurableObject(ledger, (object) => {
    expect(() => object.loadReviewAnalysis(runId)).toThrow("unavailable");
  });
});

it("reserves tool calls durably and leaves each remaining shard its allocation", async () => {
  const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
  await ledger.claimRun(
    {
      causalVersion: new Date().toISOString(),
      id: runId,
      prKey: "github:42:pr:7",
      createdAt: new Date().toISOString(),
      state: "queued",
      attempt: 0,
    },
    "budget-test",
  );
  const reservations = await Promise.all(
    Array.from({ length: 13 }, () =>
      ledger.reserveAnalysisToolCall(runId, 0, 5),
    ),
  );
  expect(reservations.filter(Boolean)).toHaveLength(12);
  await evictDurableObject(ledger);
  await expect(ledger.reserveAnalysisToolCall(runId, 0, 5)).resolves.toBe(
    false,
  );
  for (const [index, calls] of [
    [1, 12],
    [2, 12],
    [3, 12],
    [4, 12],
  ]) {
    for (let call = 0; call < calls!; call += 1)
      await expect(
        ledger.reserveAnalysisToolCall(runId, index!, 5),
      ).resolves.toBe(true);
    await expect(
      ledger.reserveAnalysisToolCall(runId, index!, 5),
    ).resolves.toBe(false);
  }
  await expect(ledger.loadAnalysisAccounting(runId)).resolves.toMatchObject({
    toolCallsCount: 60,
  });
  await runInDurableObject(ledger, (object) => {
    expect(() => object.reserveAnalysisToolCall(runId, -1, 5)).toThrow(
      "Invalid shard",
    );
  });
});
