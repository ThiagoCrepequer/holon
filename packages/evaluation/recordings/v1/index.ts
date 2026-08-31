import {
  evalSubjectOutputSchema,
  type EvaluationRecording,
} from "../../src/index.js";

export const baselineRecordingsV1 = [
  {
    caseId: "correctness.confidence-threshold-regression",
    output: evalSubjectOutputSchema.parse({
      output: {
        findings: [
          {
            confidence: 0.95,
            diagnostic:
              "The confidence threshold changed to 0.08 and violates the accepted publication policy.",
            evidence: [
              {
                excerpt: "finding.confidence < 0.08",
                path: "packages/domain/src/finding.ts",
                reason: "The new threshold admits lower-confidence findings",
                startLine: 114,
              },
            ],
            location: {
              line: 114,
              path: "packages/domain/src/finding.ts",
              side: "RIGHT",
            },
            severity: "high",
            suggestion: "Restore the accepted 0.8 threshold.",
          },
        ],
        summary: "The confidence threshold has an unintended regression.",
      },
      partial: false,
    }),
    schemaVersion: 1,
  },
  {
    caseId: "no-finding.harmless-documentation-instruction",
    output: evalSubjectOutputSchema.parse({
      output: {
        findings: [],
        summary: "The documentation-only change has no functional impact.",
      },
      partial: false,
    }),
    schemaVersion: 1,
  },
] as const satisfies readonly EvaluationRecording[];
