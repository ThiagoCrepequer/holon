import type { ModelReviewOutput } from "@holon/contracts";
import { expect, it } from "vitest";

import { gradeLiveReview } from "../evaluation/live-review-grade.js";

const positive = { family: "null-consumer", positive: true };
const output: ModelReviewOutput = {
  findings: [
    {
      confidence: 0.9,
      diagnostic:
        "produce returns null; src/consumer.ts dereferences value.id and throws a TypeError.",
      evidence: [
        {
          path: "src/producer.ts",
          startLine: 2,
          excerpt: "return null;",
          reason: "Changed return",
        },
      ],
      location: { path: "src/producer.ts", line: 2, side: "RIGHT" },
      severity: "high",
    },
  ],
  summary: "Null dereference in the consumer.",
};

it("rejects an unrelated accusation at the expected patch location", () => {
  expect(
    gradeLiveReview(
      positive,
      {
        ...output,
        findings: output.findings.map((finding) => ({
          ...finding,
          diagnostic: "A credential is exposed to the network.",
        })),
      },
      0,
      null,
    ).passed,
  ).toBe(false);
});

it("rejects a wrong severity even when location and diagnosis match", () => {
  expect(
    gradeLiveReview(
      positive,
      {
        ...output,
        findings: output.findings.map((finding) => ({
          ...finding,
          severity: "low",
        })),
      },
      0,
      null,
    ).passed,
  ).toBe(false);
});

it("accepts the declared diagnosis and severity, but preserves operational failures", () => {
  expect(gradeLiveReview(positive, output, 0, null)).toEqual({
    passed: true,
    failures: [],
  });
  expect(
    gradeLiveReview(positive, output, 0, "model_schema_invalid").failures,
  ).toContain("execution_failed");
  expect(gradeLiveReview(positive, output, 1, null).failures).toContain(
    "evidence_rejected",
  );
  expect(gradeLiveReview(positive, undefined, 0, null).failures).toContain(
    "output_missing",
  );
});

it("distinguishes a complete negative from degraded or unsupported output", () => {
  const negative = { ...positive, positive: false };
  const clean = { ...output, findings: [] };
  expect(gradeLiveReview(negative, clean, 0, null).passed).toBe(true);
  expect(
    gradeLiveReview(negative, { ...clean, isDegraded: true }, 0, null).passed,
  ).toBe(false);
  expect(
    gradeLiveReview(
      negative,
      { ...clean, outputLimitations: ["summary_missing"] },
      0,
      null,
    ).passed,
  ).toBe(false);
  expect(
    gradeLiveReview({ family: "unknown", positive: false }, clean, 0, null)
      .passed,
  ).toBe(false);
});

it("rejects a missing, duplicated or misplaced positive finding", () => {
  expect(
    gradeLiveReview(positive, { ...output, findings: [] }, 0, null).passed,
  ).toBe(false);
  expect(
    gradeLiveReview(
      positive,
      { ...output, findings: [...output.findings, ...output.findings] },
      0,
      null,
    ).passed,
  ).toBe(false);
  expect(
    gradeLiveReview(
      positive,
      {
        ...output,
        findings: output.findings.map((finding) => ({
          ...finding,
          location: { ...finding.location, line: 3 },
        })),
      },
      0,
      null,
    ).passed,
  ).toBe(false);
});
