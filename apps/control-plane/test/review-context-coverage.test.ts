import { aggregateShardReviews } from "@holon/application";
import type { StructuralImpactReport } from "@holon/contracts";
import { buildReviewPromptResult } from "@holon/model";
import {
  analyzeStructuralImpact,
  buildReviewPlan,
  splitPullRequestDiff,
} from "@holon/repository-analysis";
import { createReviewJob } from "@holon/test-kit";
import { expect, it } from "vitest";

import { liveCoverageRegressionFixtures } from "../evaluation/live-coverage-regression-fixtures.js";
import { buildShardReviewContext } from "../src/review/review-shard-context.js";

const fixture = liveCoverageRegressionFixtures[0]!;
const files = splitPullRequestDiff(fixture.patch);
const impact = analyzeStructuralImpact({
  changedFiles: files,
  repositoryFiles: Object.entries(fixture.files).map(([path, content]) => ({
    path,
    content,
  })),
});

it("distributes dense structural context before generation without losing consumer leads", () => {
  const paths = ["src/first.ts", "src/second.ts"];
  const diff = splitPullRequestDiff(
    paths
      .map(
        (path) =>
          `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-export const payload = 1;\n+export const payload = 2;\n`,
      )
      .join(""),
  );
  const dense: StructuralImpactReport = {
    changedSymbols: paths.map((path) => ({
      path,
      name: "payload",
      kind: "constant",
      line: 1,
      isExported: true,
      change: "modified",
    })),
    contractBreaks: [],
    securitySurfaces: [],
    downstreamReferences: paths.flatMap((targetPath) =>
      Array.from({ length: 40 }, (_, index) => ({
        targetPath,
        callerPath: `src/consumer-${index}.ts`,
        callerLine: index + 1,
        symbolName: "payload",
        excerpt: "á".repeat(140),
      })),
    ),
  };
  const plan = buildReviewPlan(diff, { structuralImpact: dense });
  const prompts = plan.shards.map((shard) =>
    buildReviewPromptResult(
      createReviewJob(),
      buildShardReviewContext(shard, dense, [], undefined, false),
    ),
  );
  expect(prompts.every((prompt) => !prompt.truncated)).toBe(true);
  expect(plan.scopeStatus).toBe("complete");
  expect(plan.shards).toHaveLength(2);
  expect(plan.shards.flatMap((shard) => shard.changedLines)).toHaveLength(2);
  const retained = prompts.flatMap(
    (prompt) =>
      JSON.parse(
        prompt.prompt
          .split("\n")
          .find((line) =>
            line.startsWith("Deterministic structural-impact hints: "),
          )!
          .slice("Deterministic structural-impact hints: ".length),
      ).downstreamReferences,
  );
  expect(retained).toHaveLength(80);
  expect(retained).toEqual(expect.arrayContaining(dense.downstreamReferences));
  expect(
    buildReviewPlan(diff.toReversed(), { structuralImpact: dense }),
  ).toEqual(plan);
  const limited = buildReviewPlan(diff, {
    structuralImpact: dense,
    maxShards: 1,
  });
  expect(limited.shards).toHaveLength(1);
  expect(limited.scopeStatus).toBe("partial_by_policy");
  expect(limited.omissionReasons).toContainEqual({
    code: "shard_limit",
    maximum: 1,
    planned: 2,
  });
});

it("keeps an indivisible structural context partial at the planning and publication gates", () => {
  const path = "src/single.ts";
  const diff = splitPullRequestDiff(
    `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`,
  );
  const dense: StructuralImpactReport = {
    changedSymbols: [],
    contractBreaks: [],
    securitySurfaces: [],
    downstreamReferences: Array.from({ length: 80 }, (_, index) => ({
      targetPath: path,
      callerPath: `src/consumer-${index}.ts`,
      callerLine: 1,
      symbolName: "payload",
      excerpt: "á".repeat(140),
    })),
  };
  const plan = buildReviewPlan(diff, { structuralImpact: dense });
  expect(plan.scopeStatus).toBe("partial_by_policy");
  expect(plan.omissionReasons).toContainEqual({
    code: "structural_context",
    count: 1,
    bytes: 24_000,
  });
  const prompt = buildReviewPromptResult(
    createReviewJob(),
    buildShardReviewContext(plan.shards[0]!, dense, [], undefined, false),
  );
  expect(prompt.omittedSections).toContain("structuralImpact");
  const result = aggregateShardReviews(
    plan,
    [
      {
        shardId: plan.shards[0]!.id,
        shardIndex: 0,
        status: "success",
        findings: [],
        summary: "Controlled output.",
      },
    ],
    { language: "pt-BR" },
  );
  expect(result.verdict).toBe("COMMENT");
  expect(result.omissionReasons.join(" ")).toContain("24000");
});

it("shares contract windows only when their combined structural leads fit the prompt budget", () => {
  const targets = ["src/first.ts", "src/second.ts"];
  const callers = ["src/first-caller.ts", "src/second-caller.ts"];
  const diff = splitPullRequestDiff(
    [...targets, ...callers]
      .map(
        (path) =>
          `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1,800 @@\n+payload();\n${"+marker;\n".repeat(799)}`,
      )
      .join(""),
  );
  const dense: StructuralImpactReport = {
    changedSymbols: targets.map((path) => ({
      path,
      name: "payload",
      kind: "function",
      line: 1,
      isExported: true,
      change: "modified",
    })),
    contractBreaks: [],
    securitySurfaces: [],
    downstreamReferences: targets.flatMap((targetPath, targetIndex) => [
      {
        targetPath,
        callerPath: callers[targetIndex]!,
        callerLine: 1,
        symbolName: "payload",
        excerpt: "payload();",
      },
      ...Array.from({ length: 40 }, (_, index) => ({
        targetPath,
        callerPath: `src/external-${index}.ts`,
        callerLine: 1,
        symbolName: "payload",
        excerpt: "á".repeat(140),
      })),
    ]),
  };
  const plan = buildReviewPlan(diff, { structuralImpact: dense });
  const checks = plan.shards.filter((shard) =>
    shard.id.startsWith("contract-check-"),
  );
  expect(checks).toHaveLength(2);
  for (const check of checks) {
    const prompt = buildReviewPromptResult(
      createReviewJob(),
      buildShardReviewContext(check, dense, [], undefined, false),
    );
    expect(prompt.omittedSections).not.toContain("structuralImpact");
    expect(check.files).toHaveLength(2);
  }
  expect(plan.scopeStatus).toBe("complete");
  expect(plan.omissionReasons).toEqual([]);
});

it("carries a body edit and all 131 leads through planning, shard projection and the publication gate", () => {
  expect(impact.changedSymbols).toHaveLength(131);
  expect(impact.omittedSignals).toBeUndefined();
  expect(impact.changedSymbols).toContainEqual({
    path: "src/producer.ts",
    name: "payload",
    kind: "function",
    line: 1,
    patchLine: 37,
    isExported: true,
    change: "modified",
  });
  const plan = buildReviewPlan(files, { structuralImpact: impact });
  expect(plan.scopeStatus).toBe("complete");
  expect(plan.shards).toHaveLength(1);
  const projected = buildReviewPromptResult(
    createReviewJob(),
    buildShardReviewContext(plan.shards[0]!, impact, [], undefined, false),
  );
  expect(projected.truncated).toBe(false);
  expect(projected.prompt).toContain("constant128");
  expect(projected.prompt).toContain("payload");
  // Controlled clean output tests host completeness, not the positive fixture's model recall.
  const result = aggregateShardReviews(plan, [
    {
      shardId: plan.shards[0]!.id,
      shardIndex: 0,
      status: "success",
      findings: [],
      summary: "Controlled clean output.",
    },
  ]);
  expect(result.scopeStatus).toBe("complete");
  expect(result.verdict).toBe("APPROVE");
});

it.each([false, true])(
  "keeps global gaps visible in the final gate while preserving a complete local prompt (scan=%s)",
  (scan) => {
    const partial = {
      ...impact,
      repositoryScanTruncated: scan,
      omittedSignals: {
        changedSymbols: scan ? 0 : 1,
        contractBreaks: 0,
        downstreamReferences: 0,
        securitySurfaces: 0,
      },
    };
    const plan = buildReviewPlan(files, { structuralImpact: partial });
    const projected = buildReviewPromptResult(
      createReviewJob(),
      buildShardReviewContext(plan.shards[0]!, partial, [], undefined, false),
    );
    expect(projected.truncated).toBe(false);
    expect(projected.omittedSections).toEqual([]);
    const result = aggregateShardReviews(
      plan,
      [
        {
          shardId: plan.shards[0]!.id,
          shardIndex: 0,
          status: "success",
          findings: [],
          summary: "Controlled clean output.",
        },
      ],
      { language: "pt-BR" },
    );
    expect(result.scopeStatus).toBe("partial_by_policy");
    expect(result.verdict).toBe("COMMENT");
    expect(result.omissionReasons.join(" ")).toContain(
      "Inventário estrutural incompleto",
    );
  },
);
