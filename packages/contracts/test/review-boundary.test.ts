import { expect, it } from "vitest";

import { modelReviewTransportSchema } from "../src/review-output.js";

const finding = {
  confidence: 0.9,
  diagnostic: "Removing the guard allows an unauthorized write.",
  severity: "high",
  location: { anchorId: `ev:${"a".repeat(64)}` },
  evidence: [{ id: `ev:${"a".repeat(64)}`, reason: "The guard is absent." }],
  suggestion: null,
};
it.each([undefined, null, {}, "none"])(
  "rejects invalid findings rather than certifying a clean review: %j",
  (findings) => {
    expect(() =>
      modelReviewTransportSchema.parse({
        summary: "Review completed",
        findings,
      }),
    ).toThrow();
  },
);
it.each(["85%", "0.9garbage", "2", "-1", "Infinity"])(
  "does not inflate confidence from %s",
  (confidence) => {
    expect(() =>
      modelReviewTransportSchema.parse({
        summary: "Review completed",
        findings: [{ ...finding, confidence }],
      }),
    ).toThrow();
  },
);
it("accepts explicit silence and an exact numeric confidence representation", () => {
  expect(
    modelReviewTransportSchema.parse({
      summary: "No proven defects",
      findings: [],
    }).findings,
  ).toEqual([]);
  expect(
    modelReviewTransportSchema.parse({
      summary: "Review",
      findings: [{ ...finding, confidence: "0.85" }],
    }).findings[0]?.confidence,
  ).toBe(0.85);
});
