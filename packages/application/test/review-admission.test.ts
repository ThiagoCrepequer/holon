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

it("retains prior omissions and eligible totals without cutting budgeted work", () => {
  const plan = {
    ...planFor(50),
    scopeStatus: "partial_by_policy" as const,
    omissionReasons: [{ code: "executor_budget" as const }],
  };
  const admitted = admitReviewPlan(plan);
  expect(admitted.shards).toHaveLength(50);
  expect(
    admitted.shards.every(
      (s, i) =>
        s.index === i && s.totalShards === 50 && s.id === plan.shards[i]?.id,
    ),
  ).toBe(true);
  expect(admitted.omissionReasons).toEqual([{ code: "executor_budget" }]);
  expect(admitted.totalEligibleLines).toBe(50);
  expect(admitted.scopeStatus).toBe("partial_by_policy");
  expect(admitReviewPlan(admitted)).toEqual(admitted);
});

it.each([19, 24, 50, 64])(
  "admits every eligible shard of a large %s-part review",
  (count) => {
    const plan = planFor(count);
    const admitted = admitReviewPlan(plan);
    expect(admitted.shards).toHaveLength(count);
    expect(admitted.scopeStatus).toBe("complete");
    expect(admitted.totalEligibleLines).toBe(count);
    expect(admitted.omissionReasons).toEqual([]);
  },
);
