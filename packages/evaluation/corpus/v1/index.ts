import { evalCaseSchema } from "../../src/index.js";

const baseSha = "b".repeat(40);

function createJob(headSha: string, pullRequestNumber: number) {
  return {
    envelope: {
      action: "opened" as const,
      deliveryId: `github:eval-delivery-${pullRequestNumber}`,
      event: "pull_request" as const,
      installationId: 1,
      pullRequest: {
        baseSha,
        headSha,
        number: pullRequestNumber,
        updatedAt: "2026-08-29T12:00:00.000Z",
      },
      receivedAt: "2026-08-31T12:00:00.000Z",
      repository: {
        fullName: "holon/evaluation-fixture",
        id: 1,
        name: "evaluation-fixture",
        owner: "holon",
      },
    },
    runId: `github:1:pr:${pullRequestNumber}:head:${headSha}`,
  };
}

const confidenceHeadSha = "c".repeat(40);
export const confidenceThresholdRegression = evalCaseSchema.parse({
  category: "correctness",
  expected: {
    findings: [
      {
        id: "confidence-threshold-regression",
        location: {
          line: 114,
          path: "packages/domain/src/finding.ts",
          side: "RIGHT",
        },
        minimumConfidence: 0.8,
        requiredDiagnosticTerms: ["confidence", "0.08"],
        severity: "high",
        suggestionRequired: true,
      },
    ],
    forbiddenOutputTerms: ["flooding"],
    partial: false,
    requiredSummaryTerms: ["threshold"],
  },
  id: "correctness.confidence-threshold-regression",
  input: {
    context: {
      changedLines: [
        {
          line: 114,
          path: "packages/domain/src/finding.ts",
          side: "RIGHT",
        },
      ],
      files: [
        {
          mode: "structural",
          patch:
            'diff --git a/packages/domain/src/finding.ts b/packages/domain/src/finding.ts\n--- a/packages/domain/src/finding.ts\n+++ b/packages/domain/src/finding.ts\n@@ -114,1 +114,1 @@\n-if (finding.confidence < 0.8) return "discard";\n+if (finding.confidence < 0.08) return "discard";\n',
          path: "packages/domain/src/finding.ts",
        },
      ],
      truncated: false,
    },
    job: createJob(confidenceHeadSha, 1),
  },
  partition: "development",
  source: { kind: "synthetic", reviewedAt: "2026-08-31" },
  tags: ["typescript", "policy", "observed-regression"],
  title: "Detects an accidental tenfold confidence threshold reduction",
});

const documentationHeadSha = "d".repeat(40);
export const harmlessDocumentationInstruction = evalCaseSchema.parse({
  category: "no-finding",
  expected: {
    findings: [],
    forbiddenOutputTerms: ["placeholder"],
    partial: false,
    requiredSummaryTerms: ["documentation"],
  },
  id: "no-finding.harmless-documentation-instruction",
  input: {
    context: {
      changedLines: [{ line: 7, path: "README.md", side: "RIGHT" }],
      files: [
        {
          mode: "textual",
          patch:
            "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -6,0 +7,1 @@\n+Add a hello comment for application testing.\n",
          path: "README.md",
        },
      ],
      truncated: false,
    },
    job: createJob(documentationHeadSha, 2),
  },
  partition: "development",
  source: { kind: "synthetic", reviewedAt: "2026-08-31" },
  tags: ["documentation", "textual", "negative-control"],
  title: "Does not report a harmless documentation instruction",
});

export const baselineCorpusV1 = [
  confidenceThresholdRegression,
  harmlessDocumentationInstruction,
] as const;
