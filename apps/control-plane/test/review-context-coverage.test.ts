import { aggregateShardReviews } from "@holon/application";
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
