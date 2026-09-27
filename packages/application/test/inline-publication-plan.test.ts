import { describe, expect, it } from "vitest";

import { planInlinePublications } from "../src/inline-publication-plan.js";

const finding = (fingerprint: string, extra = {}) => ({
  fingerprint,
  confidence: 0.9,
  severity: "high" as const,
  status: "new" as const,
  previousCommentId: undefined,
  ...extra,
});
describe("inline publication budget", () => {
  it("caps only eligible new comments while keeping every other finding", () => {
    const findings = [
      finding("persistent", { status: "persistent", previousCommentId: 12 }),
      finding("low", { severity: "low" }),
      finding("uncertain", { confidence: 0.7 }),
      finding("pending", { identityAmbiguous: true }),
      finding("first"),
      finding("second"),
    ];
    expect(planInlinePublications(findings, 1)).toEqual({
      inlineFingerprints: ["first"],
      overflowFingerprints: ["second"],
    });
    expect(findings).toHaveLength(6);
  });
  it("zero preserves eligible findings for the summary; replay is stable", () => {
    const findings = [finding("a"), finding("b")];
    expect(planInlinePublications(findings, 0)).toEqual({
      inlineFingerprints: [],
      overflowFingerprints: ["a", "b"],
    });
    expect(planInlinePublications(findings.toReversed(), 1)).toEqual({
      inlineFingerprints: ["a"],
      overflowFingerprints: ["b"],
    });
  });
  it("rejects invalid budgets", () => {
    for (const limit of [-1, 41, 0.5, NaN])
      expect(() => planInlinePublications([], limit)).toThrow(RangeError);
  });
});
