import { expect, it } from "vitest";

import { causalVerificationSchema, reviewTextLimits } from "../src/index.js";

const valid = {
  assessments: [
    {
      candidateIndex: 0,
      outcome: "confirmed",
      confidence: 0.9,
      rationale:
        "The reachable caller accesses the result without checking for null.",
    },
  ],
  summary: "One regression was confirmed.",
};

it.each(["confirmed", "refuted", "inconclusive"])(
  "accepts an explicit %s causal assessment",
  (outcome) => {
    expect(
      causalVerificationSchema.parse({
        ...valid,
        assessments: [{ ...valid.assessments[0], outcome }],
      }).assessments[0]?.outcome,
    ).toBe(outcome);
  },
);

it.each([
  { candidateIndex: -1 },
  { candidateIndex: reviewTextLimits.findings },
  { outcome: "approved" },
  { confidence: 1.01 },
  { confidence: "0.9" },
  { rationale: "unknown" },
  { diagnostic: "Replace the original finding." },
])("rejects an invalid or expanded assessment: %j", (invalid) => {
  expect(
    causalVerificationSchema.safeParse({
      ...valid,
      assessments: [{ ...valid.assessments[0], ...invalid }],
    }).success,
  ).toBe(false);
});

it("rejects additional findings and oversized verifier summaries", () => {
  expect(
    causalVerificationSchema.safeParse({ ...valid, findings: [] }).success,
  ).toBe(false);
  expect(
    causalVerificationSchema.safeParse({
      ...valid,
      summary: "s".repeat(reviewTextLimits.summary + 1),
    }).success,
  ).toBe(false);
});
