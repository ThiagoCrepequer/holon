import { expect, it } from "vitest";

import { compareEnvelopeAllocations } from "../src/index.js";
it("keeps minima for a mixed PR within the same aggregate envelope budget", () => {
  const minima = [1_000_000, ...Array.from({ length: 8 }, () => 50_000)];
  const plan = compareEnvelopeAllocations(minima, 4_000_000);
  expect(plan.equalRejected).toEqual([0]);
  expect(plan.feasible).toBe(true);
  expect(plan.weighted!.every((value, index) => value >= minima[index]!)).toBe(
    true,
  );
  expect(
    plan.weighted!.reduce((sum, value) => sum + value, 0) + plan.unallocated,
  ).toBe(4_000_000);
});
it("refuses an impossible minimum and never represents it as usable weighted capacity", () => {
  expect(
    compareEnvelopeAllocations([3_000_000, 3_000_000], 4_000_000),
  ).toMatchObject({ feasible: false, weighted: undefined });
  for (const values of [[], [0], [Infinity], [1.5]])
    expect(() => compareEnvelopeAllocations(values, 4_000_000)).toThrow();
  expect(() => compareEnvelopeAllocations([1], 0)).toThrow();
});
