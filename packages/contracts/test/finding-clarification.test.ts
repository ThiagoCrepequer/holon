import { expect, it } from "vitest";

import {
  clarificationAnswerSchema,
  clarificationAdmissionSchema,
} from "../src/index.js";
const answer = {
  outcome: "confirmed",
  confidence: 0.9,
  explanation: "The execution reaches the failing path.",
  scenario: "An empty input reaches run.",
  evidence: [
    { path: "src/input.ts", startLine: 1, endLine: 2, excerpt: "run(input);" },
  ],
};
it("accepts current answer outcomes and rejects invalid ranges, paths and unknown fields", () => {
  for (const outcome of ["confirmed", "narrowed", "refuted", "inconclusive"])
    expect(
      clarificationAnswerSchema.safeParse({ ...answer, outcome }).success,
    ).toBe(true);
  for (const evidence of [
    { ...answer.evidence[0], path: "../secret" },
    { ...answer.evidence[0], startLine: 0 },
    { ...answer.evidence[0], endLine: 0 },
    { ...answer.evidence[0], endLine: 201 },
    { ...answer.evidence[0], excerpt: "x".repeat(2001) },
  ])
    expect(
      clarificationAnswerSchema.safeParse({ ...answer, evidence: [evidence] })
        .success,
    ).toBe(false);
  expect(
    clarificationAnswerSchema.safeParse({ ...answer, action: "approve" })
      .success,
  ).toBe(false);
  expect(
    clarificationAnswerSchema.safeParse({
      ...answer,
      evidence: Array(7).fill(answer.evidence[0]),
    }).success,
  ).toBe(false);
  expect(
    clarificationAdmissionSchema.safeParse({ question: "x".repeat(4001) })
      .success,
  ).toBe(false);
});
