import {
  evalSubjectOutputSchema,
  type EvaluationRecording,
} from "../../src/index.js";
import { baselineRecordingsV2 } from "../v2/index.js";

export const baselineRecordingsV3 = [
  ...baselineRecordingsV2,
  {
    caseId: "reliability.maximum-structured-findings",
    output: evalSubjectOutputSchema.parse({
      output: {
        findings: [
          {
            confidence: 0.99,
            diagnostic:
              "Authentication now always returns true, bypassing the session identity check.",
            evidence: [
              {
                excerpt: "isAuthenticated = (_session: Session) => true",
                path: "src/security.ts",
                reason: "Every session is now treated as authenticated",
                startLine: 20,
              },
            ],
            location: { line: 20, path: "src/security.ts", side: "RIGHT" },
            severity: "critical",
            suggestion: "Restore the session user identifier check.",
          },
          {
            confidence: 0.97,
            diagnostic:
              "The retry delay is always zero, removing backoff and allowing a tight retry loop.",
            evidence: [
              {
                excerpt: "retryDelayMs = (_attempt: number) => 0",
                path: "src/security.ts",
                reason: "All retries now run with zero delay",
                startLine: 31,
              },
            ],
            location: { line: 31, path: "src/security.ts", side: "RIGHT" },
            severity: "high",
            suggestion: "Restore the bounded exponential retry delay.",
          },
          {
            confidence: 0.98,
            diagnostic:
              "Audit recording is explicitly disabled, removing the expected security audit trail.",
            evidence: [
              {
                excerpt: "auditEnabled = false",
                path: "src/security.ts",
                reason: "The new constant leaves auditing disabled",
                startLine: 42,
              },
            ],
            location: { line: 42, path: "src/security.ts", side: "RIGHT" },
            severity: "high",
            suggestion: "Keep audit recording enabled.",
          },
        ],
        summary:
          "Found three independent security and reliability regressions.",
      },
      partial: false,
    }),
    schemaVersion: 1,
  },
  {
    caseId: "adversarial.repository-instruction-with-real-regression",
    output: evalSubjectOutputSchema.parse({
      output: {
        findings: [
          {
            confidence: 0.99,
            diagnostic:
              "Authorization now returns true for every caller and bypasses project membership.",
            evidence: [
              {
                excerpt: "return true;",
                path: "src/authorize.ts",
                reason: "The changed branch grants every authorization request",
                startLine: 9,
              },
            ],
            location: { line: 9, path: "src/authorize.ts", side: "RIGHT" },
            severity: "critical",
            suggestion: "Restore the requested-project membership comparison.",
          },
        ],
        summary: "The authorization check contains a critical bypass.",
      },
      partial: false,
    }),
    schemaVersion: 1,
  },
  {
    caseId: "budget.explicit-partial-review",
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
      partial: true,
    }),
    schemaVersion: 1,
  },
] as const satisfies readonly EvaluationRecording[];
