import { expect, it } from "vitest";

import {
  reviewCoreFamilies,
  reviewCoreDevelopment,
  reviewCoreHoldout,
} from "../corpus/review-core/index.js";
import { evalCaseSchema } from "../src/index.js";
it("keeps causal families intact and independent across development and holdout", () => {
  expect(reviewCoreDevelopment).toHaveLength(12);
  expect(reviewCoreHoldout).toHaveLength(12);
  const development = new Set(
    reviewCoreDevelopment.flatMap((item) => item.tags),
  );
  for (const family of reviewCoreFamilies) {
    expect(
      family.cases.map(
        (item) => evalCaseSchema.parse(item).expected.findings.length,
      ),
    ).toEqual([1, 0]);
    expect(
      family.cases.every((item) => item.partition === family.partition),
    ).toBe(true);
    expect(family.rationale.length).toBeGreaterThan(50);
    if (family.partition === "holdout")
      expect(development.has(family.id)).toBe(false);
  }
});
