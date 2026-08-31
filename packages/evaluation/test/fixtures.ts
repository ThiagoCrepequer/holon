import { createReviewContext, createReviewJob } from "@holon/test-kit";

import { evalCaseSchema, type EvalCase } from "../src/index.js";

export const evaluationConfiguration = {
  corpusVersion: "baseline-v1",
  policyVersion: "review-policy-v1",
  promptVersion: "review-prompt-v1",
  subjectVersion: "recorded-output-v1",
} as const;

export function createEvalCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return evalCaseSchema.parse({
    category: "correctness",
    expected: {
      findings: [
        {
          id: "return-null",
          location: { line: 10, path: "src/index.ts", side: "RIGHT" },
          minimumConfidence: 0.8,
          requiredDiagnosticTerms: ["returns null"],
          severity: "high",
          suggestionRequired: true,
        },
      ],
      forbiddenOutputTerms: ["placeholder"],
      partial: false,
      requiredSummaryTerms: ["one finding"],
    },
    id: "correctness.return-null",
    input: {
      context: createReviewContext(),
      job: createReviewJob(),
    },
    partition: "development",
    schemaVersion: 1,
    source: { kind: "synthetic", reviewedAt: "2026-08-31" },
    tags: ["typescript", "control-flow"],
    title: "Reports a changed return value",
    ...overrides,
  });
}

export function createPassingOutput(): unknown {
  return {
    output: {
      findings: [
        {
          confidence: 0.95,
          diagnostic:
            "The changed branch returns null and breaks the established caller contract.",
          evidence: [
            {
              excerpt: "return null;",
              path: "src/index.ts",
              reason: "The new value is returned to every caller",
              startLine: 10,
            },
          ],
          location: { line: 10, path: "src/index.ts", side: "RIGHT" },
          severity: "high",
          suggestion:
            "Restore the non-null return value and add a regression test.",
        },
      ],
      summary: "Found one finding in the changed control flow.",
    },
    partial: false,
  };
}
