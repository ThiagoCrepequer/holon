import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { SnapshotToolCache } from "../../../../apps/repository-executor/src/snapshot-tool-cache.ts";
import {
  createCanonicalEvidenceVerifier,
  verifyFindingsWithCanonicalEvidence,
} from "../../../../packages/application/src/evidence.ts";
import { planReviewLanes } from "../../../../packages/application/src/review-scheduling.ts";
import { compareEnvelopeAllocations } from "../../../../packages/evaluation/src/envelope-allocation.ts";
import { reviewProofReuseDecision } from "../../../../packages/evaluation/src/proof-reuse.ts";
import { splitPullRequestDiff } from "../../../../packages/repository-analysis/src/diff.ts";
import { buildReviewPlan } from "../../../../packages/repository-analysis/src/plan.ts";

const percentile = (values: number[], p: number) =>
  values.toSorted((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * p))
  ]!;
const measurements = async (work: () => Promise<void> | void, rounds = 15) => {
  await work();
  const samples = [];
  for (let i = 0; i < rounds; i++) {
    const start = performance.now();
    await work();
    samples.push(performance.now() - start);
  }
  return {
    medianMs: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    samples,
  };
};
const path = "src/fragment.ts";
const patch = `@@ -0,0 +1,800 @@\n${Array.from({ length: 800 }, (_, i) => `+const value${i + 1} = ${i + 1};`).join("\n")}`;
const context = {
  files: [{ path, mode: "structural" as const, patch }],
  changedLines: Array.from({ length: 800 }, (_, i) => ({
    path,
    line: i + 1,
    side: "RIGHT" as const,
  })),
  truncated: false,
};
const candidate = {
  confidence: 0.95,
  diagnostic:
    "This reachable operation violates the configured caller contract.",
  severity: "high" as const,
  location: { path, line: 800, side: "RIGHT" as const },
  evidence: [
    {
      path,
      startLine: 800,
      excerpt: "const value800 = 800;",
      reason: "The final changed line proves the value.",
    },
  ],
};
const cold = await measurements(() => {
  for (let i = 0; i < 100; i++)
    if (
      verifyFindingsWithCanonicalEvidence([candidate], context).findings
        .length !== 1
    )
      throw new Error("Verification changed");
});
const prepared = await measurements(() => {
  const verifier = createCanonicalEvidenceVerifier(context);
  for (let i = 0; i < 100; i++)
    if (verifier.verify([candidate]).findings.length !== 1)
      throw new Error("Verification changed");
});

const runReads = async (cached: boolean) => {
  let executions = 0;
  const cache = new SnapshotToolCache();
  const outputs = [];
  for (let i = 0; i < 96; i++) {
    const key = `repo:42:head:a:base:b:policy:c:read:${i % 12}`;
    const execute = async () => {
      executions++;
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { content: `guard-${i % 12}`, truncated: false };
    };
    outputs.push(
      cached ? (await cache.read(key, execute)).result : await execute(),
    );
  }
  await cache.clear();
  return { executions, outputs };
};
const baselineReads = await runReads(false),
  cachedReads = await runReads(true);
if (
  JSON.stringify(baselineReads.outputs) !== JSON.stringify(cachedReads.outputs)
)
  throw new Error("Read outputs changed");
const uncached = await measurements(async () => {
  await runReads(false);
}, 7);
const reused = await measurements(async () => {
  await runReads(true);
}, 7);

const workloads = [100, 10, 10, 100, 10, 10, 100, 10, 10];
const lanes = planReviewLanes(workloads, 3);
const span = Math.max(
  ...lanes.map((lane) =>
    lane.reduce((sum, index) => sum + workloads[index], 0),
  ),
);
const waveSpan = [0, 3, 6].reduce(
  (sum, index) => sum + Math.max(...workloads.slice(index, index + 3)),
  0,
);
const simulation = async (progressive: boolean) => {
  const task = (index: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, workloads[index] / 10));
  if (progressive)
    await Promise.all(
      lanes.map(async (lane) => {
        for (const index of lane) await task(index);
      }),
    );
  else
    for (const index of [0, 3, 6])
      await Promise.all([index, index + 1, index + 2].map(task));
};
const waves = await measurements(() => simulation(false), 15),
  progressive = await measurements(() => simulation(true), 15);

const paths = ["a/consumer.ts", "b/unrelated.ts", "c/producer.ts"];
const diff = splitPullRequestDiff(
  paths
    .map(
      (filePath) =>
        `diff --git a/${filePath} b/${filePath}\n--- a/${filePath}\n+++ b/${filePath}\n@@ -0,0 +1 @@\n+export const changed = 1;\n`,
    )
    .join(""),
);
const edge = [{ callerPath: paths[0], targetPath: paths[2] }];
const ordinary = buildReviewPlan(diff, { maxShardFiles: 2 }),
  related = buildReviewPlan(diff, { maxShardFiles: 2, relationships: edge });
const coLocated = (plan: typeof ordinary) =>
  plan.shards.some((shard) =>
    edge.every((relation) =>
      [relation.callerPath, relation.targetPath].every((filePath) =>
        shard.files.some((file) => file.path === filePath),
      ),
    ),
  );
const proof = {
  installationId: 99,
  repositoryId: 42,
  memoryDigest: "memory",
  feedbackDigest: "feedback",
  baseSha: "b".repeat(40),
  configurationDigest: "c",
  promptDigest: "p",
  modelReference: "m",
  capabilityDigest: "JS/TS",
  graphComplete: true,
  completeReview: true,
  dependencies: { "producer.ts": "same", "consumer.ts": "old" },
};
const report = {
  date: "2026-10-08",
  node: process.versions.node,
  kind: "local-synthetic",
  rounds: { index: 15, reads: 7, scheduling: 15 },
  index: {
    batches: 100,
    lines: 800,
    cold,
    prepared,
    speedup: cold.medianMs / prepared.medianMs,
    outputEquivalent: true,
  },
  tools: {
    logical: 96,
    physicalBefore: baselineReads.executions,
    physicalAfter: cachedReads.executions,
    uncached,
    reused,
    outputEquivalent: true,
    latencyAssumption:
      "1 ms per physical read; excludes provider/network/container startup",
  },
  scheduling: {
    weights: workloads,
    lanes,
    waveSpan,
    progressiveSpan: span,
    idleBefore: waveSpan * 3 - workloads.reduce((a, b) => a + b),
    idleAfter: span * 3 - workloads.reduce((a, b) => a + b),
    waves,
    progressive,
    measurement: "controlled timer workload; no model quality inference",
  },
  causalGrouping: {
    baseline: ordinary.shards.map((shard) =>
      shard.files.map((file) => file.path),
    ),
    related: related.shards.map((shard) =>
      shard.files.map((file) => file.path),
    ),
    coLocatedBefore: coLocated(ordinary),
    coLocatedAfter: coLocated(related),
    note: "Static edge coverage only, not recall of an LLM",
  },
  quotas: {
    allocation: compareEnvelopeAllocations(
      [1_000_000, ...Array.from({ length: 8 }, () => 50_000)],
      4_000_000,
    ),
    equalInputBytes: Math.floor(4_000_000 / 9),
    mixedCumulativeBytes: [
      1_000_000,
      ...Array.from({ length: 8 }, () => 50_000),
    ],
    note: "A large shard does not fit equal quotas; no production weighted allocation is inferred from this mathematical example",
  },
  reuse: {
    unchanged: reviewProofReuseDecision(proof, proof),
    consumerChanged: reviewProofReuseDecision(proof, {
      ...proof,
      dependencies: { ...proof.dependencies, "consumer.ts": "changed" },
    }),
    incomplete: reviewProofReuseDecision(proof, {
      ...proof,
      graphComplete: false,
    }),
    productionEnabled: false,
  },
  diversity: {
    pairedHarnessImplemented: true,
    liveQualityMeasured: false,
    productionEnabled: false,
  },
};
await writeFile(
  new URL("./results.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    indexSpeedup: report.index.speedup,
    toolPhysicalReduction:
      1 - report.tools.physicalAfter / report.tools.physicalBefore,
    schedulerP95Reduction: 1 - progressive.p95Ms / waves.p95Ms,
  }),
);
