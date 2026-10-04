import { expect, it } from "vitest";

import {
  modelReviewOutputSchema,
  modelReviewPromptSchema,
  parseModelReviewTransport,
} from "../src/review-output.js";

const finding = {
  confidence: 0.9,
  diagnostic: "Removing the guard allows an unauthorized write.",
  severity: "high",
  location: { path: "a.ts", line: 10, side: "RIGHT", startLine: null },
  evidence: [
    {
      path: "a.ts",
      startLine: 10,
      endLine: null,
      excerpt: "write()",
      reason: "The guard is absent.",
    },
  ],
  suggestion: null,
};
it.each([undefined, null, {}, "none"])(
  "rejects invalid findings rather than certifying a clean review: %j",
  (findings) => {
    expect(() =>
      parseModelReviewTransport({ summary: "Review completed", findings }),
    ).toThrow();
  },
);
it.each(["85%", "0.9garbage", "2", "-1", "Infinity"])(
  "does not inflate confidence from %s",
  (confidence) => {
    expect(() =>
      parseModelReviewTransport({
        summary: "Review completed",
        findings: [{ ...finding, confidence }],
      }),
    ).toThrow();
  },
);
it("accepts explicit silence and an exact numeric confidence representation", () => {
  expect(
    parseModelReviewTransport({ summary: "No proven defects", findings: [] })
      .findings,
  ).toEqual([]);
  expect(
    parseModelReviewTransport({
      summary: "Review",
      findings: [{ ...finding, confidence: "0.85" }],
    }).findings[0]?.confidence,
  ).toBe(0.85);
});

it("keeps summary mandatory even for degraded model output", () => {
  expect(
    modelReviewOutputSchema.safeParse({ findings: [], isDegraded: true })
      .success,
  ).toBe(false);
  expect(() =>
    parseModelReviewTransport({ findings: [], isDegraded: true }),
  ).toThrow();
});

it.each(["", "   "])(
  "retains model findings when the narrative summary is blank (%j)",
  (summary) => {
    const output = {
      summary,
      findings: [finding],
      resolutions: [],
      investigations: [],
      isDegraded: false,
      outputLimitations: [],
    };

    expect(modelReviewPromptSchema.safeParse(output).success).toBe(true);
    const parsed = parseModelReviewTransport(output);
    expect(parsed.summary).toBe("");
    expect(parsed.isDegraded).toBe(true);
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]?.location).toEqual({
      line: 10,
      path: "a.ts",
      side: "RIGHT",
    });
    expect(
      modelReviewOutputSchema.safeParse({
        ...parsed,
        isDegraded: false,
      }).success,
    ).toBe(false);
  },
);
