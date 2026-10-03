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
const runId =
  `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}` as const;

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
    output: { language: "en", detail: "concise", maxInlineComments: 0 },
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
  const expanded = buildReviewAnalysisCheckpoint({
    ...output,
    activeFindings: Array.from({ length: 512 }, (_, i) => ({
      ...findings[0]!,
      fingerprint: `fp:${i.toString(16).padStart(64, "0")}`,
      location: {
        ...findings[0]!.location,
        path: `src/${"長".repeat(1_000)}.ts`,
      },
    })),
  });
  expect(expanded.activeFindings).toHaveLength(512);
  expect(
    new TextEncoder().encode(JSON.stringify(expanded)).length,
  ).toBeLessThan(128_000);
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
  await evictDurableObject(ledger);
  await runInDurableObject(ledger, (object) => {
    expect(() => object.loadReviewAnalysis(runId)).toThrow("unavailable");
  });
});

it("reserves one shared tool-call ceiling across shards and eviction", async () => {
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
  await ledger.transition(
    runId,
    "queued",
    "running",
    new Date().toISOString(),
    "budget-test:start",
  );
  const reservations = await Promise.all(
    Array.from({ length: 97 }, () =>
      ledger.reserveAnalysisToolCall(runId, 0, 5),
    ),
  );
  expect(reservations.filter(Boolean)).toHaveLength(96);
  await evictDurableObject(ledger);
  await expect(ledger.reserveAnalysisToolCall(runId, 0, 5)).resolves.toBe(
    false,
  );
  await expect(ledger.reserveAnalysisToolCall(runId, 4, 5)).resolves.toBe(
    false,
  );
  await runInDurableObject(ledger, (_object, state) => {
    expect(
      state.storage.sql
        .exec(
          "SELECT SUM(calls) AS calls FROM review_tool_budgets WHERE run_id=?",
          runId,
        )
        .one().calls,
    ).toBe(96);
  });
  await runInDurableObject(ledger, (object) => {
    expect(() => object.reserveAnalysisToolCall(runId, -1, 5)).toThrow(
      "Invalid shard",
    );
  });
});

it("allows the last shard of a 64-part plan to spend the shared budget", async () => {
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
    "large-budget-test",
  );
  await ledger.transition(
    runId,
    "queued",
    "running",
    new Date().toISOString(),
    "large-budget-test:start",
  );
  const results = await Promise.all(
    Array.from({ length: 25 }, () =>
      ledger.reserveAnalysisToolCall(runId, 63, 64),
    ),
  );
  expect(results.filter(Boolean)).toHaveLength(25);
  await evictDurableObject(ledger);
  for (let index = 0; index < 71; index++)
    await expect(
      ledger.reserveAnalysisToolCall(runId, index % 64, 64),
    ).resolves.toBe(true);
  await expect(ledger.reserveAnalysisToolCall(runId, 63, 64)).resolves.toBe(
    false,
  );
  await expect(ledger.reserveAnalysisToolCall(runId, 0, 64)).resolves.toBe(
    false,
  );
  await runInDurableObject(ledger, (object) => {
    expect(() => object.reserveAnalysisToolCall(runId, 64, 64)).toThrow(
      "Invalid shard",
    );
    expect(() => object.reserveAnalysisToolCall(runId, 0, 65)).toThrow(
      "Invalid shard",
    );
  });
});
