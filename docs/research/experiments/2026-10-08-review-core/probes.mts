// Diagnostic probes for the dated audit; not regression expectations.
import assert from "node:assert/strict";

import { buildShardReviewContext } from "../../../../apps/control-plane/src/review/review-shard-context.js";
import { executeRepositoryTool } from "../../../../apps/repository-executor/src/repository-tools.js";
import { aggregateShardReviews } from "../../../../packages/application/src/aggregate-reviews.js";
import { verifyFindingsWithCanonicalEvidence } from "../../../../packages/application/src/evidence.js";
import { baselineCorpusV4 } from "../../../../packages/evaluation/corpus/v4/index.js";
import { runEvaluationSuite } from "../../../../packages/evaluation/src/runner.js";
import { buildReviewPromptResult } from "../../../../packages/model/src/reviewer.js";
import { buildReviewPlan } from "../../../../packages/repository-analysis/src/plan.js";

const path = "src/large.ts";
const patch = `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,0 +1,800 @@\n${Array.from({ length: 800 }, (_, i) => `+const value${i + 1} = ${i + 1};`).join("\n")}\n`;
const plan = buildReviewPlan([
  { path, oldPath: path, newPath: path, changeType: "modified", patch },
]);
assert.equal(plan.scopeStatus, "complete");
assert.ok(plan.shards.length > 1);
const last = plan.shards.at(-1)!;
const candidate = {
  confidence: 0.95,
  diagnostic: "The introduced value breaks the documented runtime invariant.",
  evidence: [
    {
      path,
      startLine: 800,
      excerpt: "const value800 = 800;",
      reason: "The changed assignment violates the invariant.",
    },
  ],
  location: { path, line: 800, side: "RIGHT" as const },
  severity: "high" as const,
};
const results = plan.shards.map((shard) => ({
  shardId: shard.id,
  shardIndex: shard.index,
  status: "success" as const,
  summary: "Analyzed this shard.",
  findings: shard.id === last.id ? [candidate] : [],
}));
assert.equal(
  verifyFindingsWithCanonicalEvidence([candidate], {
    files: last.files,
    changedLines: last.changedLines,
    truncated: false,
  }).findings.length,
  1,
);
const aggregated = aggregateShardReviews(plan, results);
console.log(
  JSON.stringify({
    probe: "fragmented-file",
    shards: plan.shards.length,
    locallyVerified: 1,
    aggregateFindings: aggregated.findings.length,
    verdict: aggregated.verdict,
    scope: aggregated.scopeStatus,
  }),
);

const duplicate = aggregateShardReviews(
  plan,
  plan.shards.map(() => ({ ...results[0], findings: [] })),
);
console.log(
  JSON.stringify({
    probe: "duplicate-shard-id",
    shardsAnalyzed: duplicate.shardsAnalyzed,
    totalShards: duplicate.totalShards,
    verdict: duplicate.verdict,
  }),
);
const rejected = aggregateShardReviews(
  plan,
  results.map((r) => ({
    ...r,
    findings: r.findings.map((f) => ({
      ...f,
      evidence: [{ ...f.evidence[0], excerpt: "invented code" }],
    })),
  })),
);
console.log(
  JSON.stringify({
    probe: "aggregate-rejected-evidence",
    findings: rejected.findings.length,
    degraded: rejected.isDegraded ?? false,
    verdict: rejected.verdict,
  }),
);
const limitation = aggregateShardReviews(
  plan,
  results.map((r) => ({
    ...r,
    findings: [],
    outputLimitations: ["summary_missing" as const],
  })),
);
console.log(
  JSON.stringify({
    probe: "limitation-without-flag",
    degraded: limitation.isDegraded ?? false,
    verdict: limitation.verdict,
    mentionsMissing: limitation.summary.includes("summary_missing"),
  }),
);

const whitespacePath = "src/spaces.ts";
const spaces = {
  files: [
    {
      mode: "structural" as const,
      path: whitespacePath,
      patch: "@@ -1,0 +1 @@\n+const message = 'a  b';",
    },
  ],
  changedLines: [{ path: whitespacePath, line: 1, side: "RIGHT" as const }],
  truncated: false,
};
const altered = {
  ...candidate,
  location: { path: whitespacePath, line: 1, side: "RIGHT" as const },
  evidence: [
    {
      path: whitespacePath,
      startLine: 1,
      excerpt: "const message = 'a b';",
      reason: "Claim relies on changed literal.",
    },
  ],
};
console.log(
  JSON.stringify({
    probe: "literal-whitespace",
    accepted: verifyFindingsWithCanonicalEvidence([altered], spaces).findings
      .length,
  }),
);

const sandbox: import("../../../../apps/repository-executor/src/sandbox-port.js").SandboxPort =
  {
    configureGitHubEgress: async () => {},
    blockGitHubEgress: async () => {},
    destroy: async () => {},
    exists: async () => true,
    writeFile: async () => {},
    readFile: async (p: string) =>
      p.endsWith("scope.json")
        ? JSON.stringify({ deniedPaths: [], additionalExcludes: [] })
        : JSON.stringify({
            effectivePolicyDigest: "c".repeat(64),
            policySource: "default",
            sourceDigest: null,
            verdictStrictness: "default",
            waiversCount: 0,
            files: [
              {
                mode: "structural",
                path: "src/index.ts",
                patch: "@@ -1,0 +1 @@\n+const a=1;",
              },
            ],
            changedLines: [{ path: "src/index.ts", line: 1, side: "RIGHT" }],
            truncated: false,
          }),
    run: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        file: "src/service.py",
        text: "def consume(): pass",
      }),
      stderr: "",
      truncated: false,
    }),
  };
const searched = await executeRepositoryTool(
  sandbox,
  baselineCorpusV4[0].input.job.runId,
  {
    name: "search_structure",
    arguments: {
      language: "python",
      pattern: "def $NAME(): $$$",
      maxResults: 10,
    },
  },
);
console.log(
  JSON.stringify({
    probe: "python-structural-search",
    content: searched.content,
    truncated: searched.truncated,
  }),
);

const negative = baselineCorpusV4.at(-1)!;
const evaluation = await runEvaluationSuite(
  [negative],
  async () => ({
    output: {
      findings: [
        {
          ...candidate,
          location: { path: "src/client.ts", line: 1, side: "RIGHT" },
          evidence: [
            {
              path: "src/client.ts",
              startLine: 1,
              excerpt: "fabricated evidence",
              reason: "Fabricated cause.",
            },
          ],
        },
      ],
      summary: "A safe summary.",
    },
    partial: false,
  }),
  {
    corpusVersion: "v4",
    mode: "mock-model",
    modelReference: null,
    policyVersion: "audit",
    promptVersion: "audit",
    subjectVersion: "audit",
  },
);
console.log(
  JSON.stringify({
    probe: "evaluation-fabrication-negative",
    passedCases: evaluation.passedCases,
    failedCases: evaluation.failedCases,
    precision: evaluation.metrics.precision,
    rejected: evaluation.metrics.rejectedFindings,
  }),
);

const baseline = Array.from({ length: 9 }, (_, i) => ({
  fingerprint: `fp:${String(i).padStart(64, "0")}`,
  status: "new" as const,
  filePath: path,
  line: 1,
  prKey: "github:1:pr:1" as const,
  evidenceFingerprint: "d".repeat(64),
  firstSeenHeadSha: "a".repeat(40),
  lastSeenHeadSha: "a".repeat(40),
  firstSeenRunId: negative.input.job.runId,
  lastSeenRunId: negative.input.job.runId,
  updatedAt: "2026-10-08T00:00:00.000Z",
  diagnostic: "A previous defect requires positive correction evidence.",
  severity: "high" as const,
  confidence: 0.95,
}));
const shardContext = buildShardReviewContext(
  plan.shards[0],
  undefined,
  baseline,
  undefined,
  false,
);
const prompt = buildReviewPromptResult(negative.input.job, shardContext);
console.log(
  JSON.stringify({
    probe: "prior-findings-cap",
    baseline: baseline.length,
    projected: shardContext.priorFindings?.length,
    promptTruncated: prompt.truncated,
    omissions: prompt.omittedSections,
  }),
);

const { GitHubReviewPublisher } =
  await import("../../../../packages/github/src/publisher.js");
const marker = "<!-- holon; probe=bounded-reconciliation -->";
let pagesVisited = 0;
const publisher = new GitHubReviewPublisher(
  {
    async *iterate() {
      for (let page = 1; page <= 21; page++) {
        pagesVisited++;
        yield Array.from({ length: 100 }, (_, index) => ({
          id: page * 100 + index,
          body: page === 21 && index === 0 ? marker : "Other review",
          user: { type: "Bot", login: "holon[bot]" },
        }));
      }
    },
    request: async () => ({ data: { id: 999 } }),
  },
  {
    expectedAuthorLogin: "holon[bot]",
    headSha: "a".repeat(40),
    owner: "audit",
    pullNumber: 1,
    repo: "synthetic",
  },
);
const found = await publisher.findCommentByMarker(marker, "summary");
console.log(
  JSON.stringify({
    probe: "pagination-negative",
    markerExistsOnPage: 21,
    pagesVisited,
    found: found ?? null,
  }),
);

const { computeCalibrationMetrics } =
  await import("../../../../packages/evaluation/src/calibration.js");
const feedback = {
  authorLogin: "reviewer",
  createdAt: "2026-10-08T00:00:00.000Z",
  fingerprint: baseline[0].fingerprint,
  prKey: "github:1:pr:1" as const,
};
console.log(
  JSON.stringify({
    probe: "calibration-thread-resolved",
    metrics: computeCalibrationMetrics(
      [{ ...feedback, label: "thread_resolved" }],
      1,
    ),
  }),
);
console.log(
  JSON.stringify({
    probe: "calibration-duplicate-feedback",
    metrics: computeCalibrationMetrics(
      [
        { ...feedback, label: "false_positive" },
        { ...feedback, label: "not_actionable" },
      ],
      1,
    ),
  }),
);

const { computeStableFingerprint } =
  await import("../../../../packages/domain/src/fingerprint.js");
const fingerprintInput = {
  path: whitespacePath,
  diagnostic: "A literal changes the required value.",
};
console.log(
  JSON.stringify({
    probe: "literal-fingerprint",
    equal:
      (await computeStableFingerprint({
        ...fingerprintInput,
        excerpt: "const message = 'a b';",
      })) ===
      (await computeStableFingerprint({
        ...fingerprintInput,
        excerpt: "const message = 'a  b';",
      })),
  }),
);

const positive = baselineCorpusV4.find(
  (item) => item.expected.findings.length > 0,
)!;
const errors = await runEvaluationSuite(
  [positive, negative],
  async (input) => {
    if (input.caseId === positive.id)
      throw new Error("Synthetic provider failure");
    return {
      output: { findings: [], summary: "Analyzed this case." },
      partial: false,
    };
  },
  {
    corpusVersion: "v4",
    mode: "mock-model",
    modelReference: null,
    policyVersion: "audit",
    promptVersion: "audit",
    subjectVersion: "audit",
  },
);
console.log(
  JSON.stringify({
    probe: "recall-after-subject-error",
    subjectErrors: errors.subjectErrors,
    expectedFindings: errors.metrics.expectedFindings,
    recall: errors.metrics.recall,
    failedCases: errors.failedCases,
  }),
);
console.log(
  JSON.stringify({
    probe: "corpus-partitions",
    cases: baselineCorpusV4.length,
    holdout: baselineCorpusV4.filter((item) => item.partition === "holdout")
      .length,
  }),
);
