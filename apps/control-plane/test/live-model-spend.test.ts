import { expect, it } from "vitest";

import {
  LiveModelSpend,
  modelSpendPolicy,
} from "../evaluation/live-model-spend.js";

it("reserves both possible route attempts before sending and denies overspending", () => {
  const spend = new LiveModelSpend([], 10_000);
  expect(spend.reserve("first", 1, 1)).toBe(false);
  expect(spend.snapshot().records).toEqual([]);
  const allowed = new LiveModelSpend([], 2_000_000);
  expect(allowed.reserve("first", 1, 1)).toBe(true);
  expect(allowed.snapshot().exposureNanodollars).toBe(769_875);
  expect(allowed.reserve("second", 1, 1)).toBe(true);
  expect(allowed.reserve("third", 1, 1)).toBe(false);
});

it("preserves uncertain exposure across process restoration and settles only known cost", () => {
  const spend = new LiveModelSpend([], 2_000_000);
  expect(spend.reserve("uncertain", 1, 1)).toBe(true);
  const recovered = new LiveModelSpend(spend.snapshot().records, 2_000_000);
  expect(recovered.snapshot().exposureNanodollars).toBe(769_875);
  expect(recovered.reserve("uncertain", 1, 1)).toBe(false);
  recovered.settle("uncertain", 0.0001);
  expect(recovered.snapshot().exposureNanodollars).toBe(125_000);
  expect(modelSpendPolicy.limitUSD).toBe(0.5);
});

it("keeps an unexpected price overrun charged and blocks subsequent requests", () => {
  const spend = new LiveModelSpend([], 2_000_000);
  expect(spend.reserve("first", 1, 1)).toBe(true);
  spend.settle("first", 0.003);
  expect(spend.snapshot().exposureNanodollars).toBe(3_750_000);
  expect(spend.reserve("next", 1, 1)).toBe(false);
  expect(() => spend.settle("first", Number.NaN)).toThrow();
});
