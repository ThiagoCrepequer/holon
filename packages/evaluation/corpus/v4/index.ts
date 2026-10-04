import { evalCaseSchema } from "../../src/index.js";
import { harmlessDocumentationInstruction } from "../v3/index.js";
import { baselineCorpusV3 } from "../v3/index.js";

function negativeCase(
  id: string,
  title: string,
  pullRequestNumber: number,
  headCharacter: string,
  files: readonly { mode: "structural"; path: string; patch: string }[],
  changedLines: readonly { line: number; path: string; side: "RIGHT" }[],
) {
  const base = harmlessDocumentationInstruction;
  const headSha = headCharacter.repeat(40);
  return evalCaseSchema.parse({
    ...base,
    id,
    title,
    category: "no-finding",
    expected: {
      findings: [],
      forbiddenOutputTerms: [],
      partial: false,
      requiredSummaryTerms: [],
    },
    input: {
      context: { changedLines, files, truncated: false },
      job: {
        ...base.input.job,
        envelope: {
          ...base.input.job.envelope,
          deliveryId: `github:eval-delivery-${pullRequestNumber}`,
          pullRequest: {
            ...base.input.job.envelope.pullRequest,
            headSha,
            number: pullRequestNumber,
          },
        },
        runId: `github:1:pr:${pullRequestNumber}:head:${headSha}:base:${base.input.job.envelope.pullRequest.baseSha}`,
      },
    },
    source: { kind: "synthetic", reviewedAt: "2026-10-04" },
    tags: ["typescript", "contract", "negative-control"],
  });
}

export const requiredButEmptySummary = negativeCase(
  "no-finding.required-but-empty-summary",
  "Keeps a required output field while normalizing its empty value",
  6,
  "6",
  [
    {
      mode: "structural",
      path: "src/review-output.ts",
      patch:
        "diff --git a/src/review-output.ts b/src/review-output.ts\n--- a/src/review-output.ts\n+++ b/src/review-output.ts\n@@ -1,7 +1,10 @@\n const outputSchema = z.object({\n-  summary: z.string().min(1),\n+  summary: z.string().max(1000),\n   isDegraded: z.boolean().optional(),\n });\n function parseTransport(transport: { summary: string; isDegraded?: boolean }) {\n-  return outputSchema.parse(transport);\n+  return outputSchema.parse({\n+    ...transport,\n+    isDegraded: transport.summary.length === 0 || transport.isDegraded,\n+  });\n }\n",
    },
  ],
  [
    { line: 2, path: "src/review-output.ts", side: "RIGHT" },
    { line: 6, path: "src/review-output.ts", side: "RIGHT" },
    { line: 7, path: "src/review-output.ts", side: "RIGHT" },
    { line: 8, path: "src/review-output.ts", side: "RIGHT" },
    { line: 9, path: "src/review-output.ts", side: "RIGHT" },
  ],
);

export const preservedTypeReexport = negativeCase(
  "no-finding.preserved-type-reexport",
  "Preserves a public type after moving its declaration",
  7,
  "7",
  [
    {
      mode: "structural",
      path: "src/client.ts",
      patch:
        'diff --git a/src/client.ts b/src/client.ts\n--- a/src/client.ts\n+++ b/src/client.ts\n@@ -1,4 +1,1 @@\n-export interface Credentials {\n-  readonly appId: number;\n-  readonly privateKey: string;\n-}\n+export type { Credentials } from "./authentication.js";\n',
    },
    {
      mode: "structural",
      path: "src/authentication.ts",
      patch:
        "diff --git a/src/authentication.ts b/src/authentication.ts\n--- a/src/authentication.ts\n+++ b/src/authentication.ts\n@@ -1,0 +1,4 @@\n+export interface Credentials {\n+  readonly appId: number;\n+  readonly privateKey: string;\n+}\n",
    },
  ],
  [
    { line: 1, path: "src/client.ts", side: "RIGHT" },
    { line: 1, path: "src/authentication.ts", side: "RIGHT" },
    { line: 2, path: "src/authentication.ts", side: "RIGHT" },
    { line: 3, path: "src/authentication.ts", side: "RIGHT" },
    { line: 4, path: "src/authentication.ts", side: "RIGHT" },
  ],
);

export const baselineCorpusV4 = [
  ...baselineCorpusV3,
  requiredButEmptySummary,
  preservedTypeReexport,
] as const;
