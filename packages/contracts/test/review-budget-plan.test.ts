import { expect, it } from "vitest";

import {
  createReviewBudgetPlan,
  reviewBudgetPlanSchema,
  reviewShardBudget,
  selectReviewBudgetProfile,
} from "../src/model-generation-budget.js";

it.each([
  [1, "normal"],
  [9, "normal"],
  [10, "large"],
  [19, "large"],
  [24, "large"],
  [25, "very_large"],
  [64, "very_large"],
] as const)("selects the bounded profile for %s parts", (count, profile) => {
  expect(createReviewBudgetPlan(count).profile).toBe(profile);
});
it("promotes a profile for cumulative prompt size before work starts", () => {
  expect(selectReviewBudgetProfile(1, 4_000_000)).toBe("normal");
  expect(selectReviewBudgetProfile(1, 4_000_001)).toBe("large");
  expect(selectReviewBudgetProfile(19, 12_000_001)).toBe("very_large");
});
it.each([0, 65, -1, 1.5, Number.MAX_SAFE_INTEGER])(
  "rejects invalid count %s before allocating an array",
  (count) => {
    expect(() => createReviewBudgetPlan(count)).toThrow();
  },
);
it("rejects a cheaper persisted profile, unknown fields and invalid risk weights", () => {
  const plan = createReviewBudgetPlan(19);
  expect(
    reviewBudgetPlanSchema.safeParse({ ...plan, profile: "normal" }).success,
  ).toBe(false);
  expect(
    reviewBudgetPlanSchema.safeParse({ ...plan, extra: true }).success,
  ).toBe(false);
  expect(() => createReviewBudgetPlan(2, 0, [1])).toThrow();
  expect(() => createReviewBudgetPlan(2, 0, [0, 5])).toThrow();
  expect(() => selectReviewBudgetProfile(1, -1)).toThrow();
});
it("keeps equal investigation protection while weighting discretionary capacity", () => {
  const plan = createReviewBudgetPlan(2, 0, [4, 1]);
  const high = reviewShardBudget(plan, 0);
  const low = reviewShardBudget(plan, 1);
  expect(high.protectedBudget).toEqual({
    calls: 4,
    inputBytes: 1_400_000,
    outputTokens: 42_000,
    toolCalls: 3,
  });
  expect(low.protectedBudget).toEqual(high.protectedBudget);
  expect(high.allocation.calls).toBe(48);
  expect(low.allocation.calls).toBe(15);
  expect(high.allocation.inputBytes).toBe(2_360_000);
  expect(low.allocation.inputBytes).toBe(1_640_000);
  expect(() => reviewShardBudget(plan, 2)).toThrow();
});
