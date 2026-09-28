import { describe, expect, it } from "vitest";

import { modelReviewTransportSchema, limitReviewText } from "../src/index.js";

const finding = () => ({
  confidence: 0.95,
  diagnostic: "A proven regression. ".repeat(60),
  evidence: [
    { id: `ev:${"a".repeat(64)}`, reason: "Causal explanation. ".repeat(20) },
  ],
  location: { anchorId: `ev:${"a".repeat(64)}` },
  severity: "high",
  suggestion: "Restore the guard. ".repeat(80),
});

describe("review output retention", () => {
  it("retains useful text and findings beyond the former limits", () => {
    const raw = {
      findings: Array.from({ length: 4 }, finding),
      summary: "Review result. ".repeat(400),
    };
    const parsed = modelReviewTransportSchema.parse(raw);
    expect(parsed.findings).toHaveLength(4);
    expect(parsed.findings[0]?.diagnostic).toBe(
      raw.findings[0]?.diagnostic.trim(),
    );
    expect(parsed.findings[0]?.evidence[0]?.id).toBe(
      raw.findings[0]?.evidence[0]?.id,
    );
    expect(parsed.summary).toBe(raw.summary.trim());
  });
  it("reports every bounded loss, including normalization inside the SDK", () => {
    const large = finding();
    large.diagnostic = "😀".repeat(1_500);
    large.suggestion = "s".repeat(4_000);
    large.evidence = Array.from({ length: 5 }, () => ({
      ...large.evidence[0]!,
      reason: "r".repeat(700),
    }));
    const sdkOutput = modelReviewTransportSchema.parse({
      findings: Array.from({ length: 9 }, () => large),
      summary: "s".repeat(12_000),
    });
    const parsed = modelReviewTransportSchema.parse(sdkOutput);
    expect(parsed.findings).toHaveLength(8);
    expect(parsed.findings[0]?.evidence).toHaveLength(4);
    expect(parsed.findings[0]?.diagnostic.isWellFormed()).toBe(true);
    expect(parsed.isDegraded).toBe(true);
    expect(parsed.outputLimitations).toEqual(
      expect.arrayContaining([
        "diagnostic_truncated",
        "suggestion_truncated",
        "reason_truncated",
        "summary_truncated",
        "findings_omitted",
        "evidence_omitted",
      ]),
    );
    expect(parsed.findings[0]?.evidence[0]?.id).toBe(`ev:${"a".repeat(64)}`);
  });
  it("does not fabricate a verification claim to pad a short diagnostic", () => {
    expect(() =>
      modelReviewTransportSchema.parse({
        findings: [{ ...finding(), diagnostic: "Too short" }],
        summary: "Complete",
      }),
    ).toThrow();
    expect(limitReviewText("abc😀def", 5)).toBe("abc…");
  });
});
