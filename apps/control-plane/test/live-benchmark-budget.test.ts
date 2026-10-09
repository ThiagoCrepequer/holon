import { expect, it } from "vitest";

import { LiveBenchmarkBudget } from "../evaluation/live-benchmark-budget.js";

it("keeps request counters unused when campaign spending refuses admission", () => {
  const budget = new LiveBenchmarkBudget({
    calls: 2,
    inputBytes: 100,
    outputTokens: 20,
  });
  expect(budget.admit(10, 1, () => false)).toBe(false);
  expect(budget.snapshot()).toEqual({
    calls: 0,
    inputBytes: 0,
    reservedOutputTokens: 0,
    denied: 1,
  });
  expect(budget.admit(100, 20, () => true)).toBe(true);
});

it("rejects a generation before transport when any independent benchmark cap is exceeded", () => {
  const budget = new LiveBenchmarkBudget({
    calls: 2,
    inputBytes: 100,
    outputTokens: 20,
  });
  expect(budget.admit(50, 10)).toBe(true);
  expect(budget.admit(51, 1)).toBe(false);
  expect(budget.admit(1, 11)).toBe(false);
  expect(budget.admit(50, 10)).toBe(true);
  expect(budget.admit(1, 1)).toBe(false);
  expect(budget.snapshot()).toEqual({
    calls: 2,
    inputBytes: 100,
    reservedOutputTokens: 20,
    denied: 3,
  });
});

it("retains the full reservation after an uncertain provider outcome", () => {
  const budget = new LiveBenchmarkBudget({
    calls: 3,
    inputBytes: 100,
    outputTokens: 20,
  });
  expect(budget.admit(1, 20)).toBe(true);
  expect(budget.admit(1, 1)).toBe(false);
  expect(budget.snapshot().reservedOutputTokens).toBe(20);
});

it("rejects invalid caps and sizes without spending a reservation", () => {
  expect(
    () =>
      new LiveBenchmarkBudget({ calls: 0, inputBytes: 100, outputTokens: 20 }),
  ).toThrow();
  const budget = new LiveBenchmarkBudget({
    calls: 2,
    inputBytes: 100,
    outputTokens: 20,
  });
  expect(() => budget.admit(-1, 10)).toThrow();
  expect(() => budget.admit(1, NaN)).toThrow();
  expect(budget.snapshot().calls).toBe(0);
});
