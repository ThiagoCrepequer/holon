import { expect, it } from "vitest";

import { determineReviewVerdict } from "../src/verdict.js";
it("never blocks on a finding below the publication threshold", () => {
  expect(
    determineReviewVerdict({
      findings: [{ severity: "high", confidence: 0.79 }],
      scopeStatus: "complete",
    }).verdict,
  ).toBe("COMMENT");
});
it("acknowledges a non-blocking medium defect instead of claiming clean code", () => {
  const result = determineReviewVerdict({
    findings: [{ severity: "medium", confidence: 0.82 }],
    scopeStatus: "complete",
  });
  expect(result).toMatchObject({
    verdict: "APPROVE",
    advisoryFindingsCount: 1,
  });
  expect(result.reasons.join(" ")).not.toContain("no defects");
});
