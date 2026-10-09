import { expect, it } from "vitest";

import { planReviewLanes } from "../src/review-scheduling.js";
it("gives short lanes their next shard without waiting for a slow peer", () => {
  const weights = [100, 10, 10, 100, 10, 10, 100, 10, 10];
  const lanes = planReviewLanes(weights, 3);
  expect(lanes.map((lane) => weights[lane[0]!])).toEqual([100, 100, 100]);
  expect(lanes.flat().toSorted((a, b) => a - b)).toEqual(
    weights.map((_, i) => i),
  );
  const duration = Math.max(
    ...lanes.map((lane) =>
      lane.reduce((sum, index) => sum + weights[index]!, 0),
    ),
  );
  expect(duration).toBe(120);
  expect(lanes.every((lane) => lane.length <= 3)).toBe(true);
});
it("handles fewer tasks and refuses invalid weights", () => {
  expect(planReviewLanes([], 3)).toEqual([]);
  expect(planReviewLanes([1, 2], 3)).toEqual([[1], [0]]);
  expect(() => planReviewLanes([NaN], 3)).toThrow();
});
