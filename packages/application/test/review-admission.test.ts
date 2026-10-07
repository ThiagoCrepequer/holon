import {
  reviewGenerationCallsPerShard,
  modelGenerationLimits,
} from "@holon/contracts";
import type { ReviewPlan } from "@holon/contracts";
import { expect, it } from "vitest";

import { admitReviewPlan } from "../src/review-admission.js";

function planFor(count: number): ReviewPlan {
  return {
    scopeStatus: "complete",
    omissionReasons: [],
    totalEligibleBytes: count,
    totalEligibleFiles: count,
    totalEligibleLines: count,
    unsupportedFilesCount: 0,
    shards: Array.from({ length: count }, (_, index) => ({
      byteLength: 1,
      changedLines: [{ path: `src/${index}.ts`, line: 1, side: "RIGHT" }],
      files: [
        {
          path: `src/${index}.ts`,
          mode: "structural",
          patch: "@@ -0,0 +1 @@\n+changed\n",
        },
      ],
      id: `shard-${index}`,
      index,
      totalShards: count,
      surface: [],
    })),
  };
}

it.each([0, 1, 9])(
  "retains complete affordable coverage of %s shards",
  (count) => {
    const plan = planFor(count);
    expect(admitReviewPlan(plan)).toBe(plan);
  },
);

it("omits unbudgeted work before dispatch and retains prior omissions and eligible totals", () => {
  const plan = {
    ...planFor(50),
    scopeStatus: "partial_by_policy" as const,
    omissionReasons: [{ code: "executor_budget" as const }],
  };
  const admitted = admitReviewPlan(plan);
  expect(admitted.shards).toHaveLength(9);
  expect(
    admitted.shards.every(
      (s, i) =>
        s.index === i && s.totalShards === 9 && s.id === plan.shards[i]?.id,
    ),
  ).toBe(true);
  expect(
    admitted.shards.length * reviewGenerationCallsPerShard,
  ).toBeLessThanOrEqual(modelGenerationLimits.calls);
  expect(admitted.omissionReasons).toEqual([
    { code: "executor_budget" },
    { code: "model_budget", maximum: 9, planned: 50 },
  ]);
  expect(admitted.totalEligibleLines).toBe(50);
  expect(admitted.scopeStatus).toBe("partial_by_policy");
  expect(admitReviewPlan(admitted)).toEqual(admitted);
});
