import { z } from "zod";

import { repositoryPathSchema } from "./shared.js";

export const lineCoverageSchema = z.strictObject({
  hitsByLine: z.record(z.string(), z.number().int().nonnegative()),
  path: repositoryPathSchema,
  totalFound: z.number().int().nonnegative(),
  totalHit: z.number().int().nonnegative(),
});

export const testFailureSchema = z.strictObject({
  filePath: repositoryPathSchema.optional(),
  line: z.number().int().positive().optional(),
  message: z.string().max(4_000),
  testName: z.string().min(1).max(300),
});

export const testExecutionReportSchema = z.strictObject({
  durationMs: z.number().nonnegative().optional(),
  failed: z.number().int().nonnegative(),
  failures: z.array(testFailureSchema).max(50),
  passed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const ciEvidenceStatusSchema = z.enum([
  "available",
  "partial",
  "not_available",
]);

export const ciEvidenceSchema = z.strictObject({
  limitations: z.array(z.string().max(300)).max(10).optional(),
  coverage: z.array(lineCoverageSchema).optional(),
  source: z.string().max(100).optional(),
  status: ciEvidenceStatusSchema,
  tests: testExecutionReportSchema.optional(),
  workflowName: z.string().max(200).optional(),
  workflowRunId: z.number().int().positive().optional(),
});

export type LineCoverage = z.infer<typeof lineCoverageSchema>;
export type TestFailure = z.infer<typeof testFailureSchema>;
export type TestExecutionReport = z.infer<typeof testExecutionReportSchema>;
export type CiEvidenceStatus = z.infer<typeof ciEvidenceStatusSchema>;
export type CiEvidence = z.infer<typeof ciEvidenceSchema>;

export const ciSummarySchema = z.strictObject({
  durationMs: z.number().int().nonnegative().safe().nullable(),
  failed: z.number().int().nonnegative().safe(),
  passed: z.number().int().nonnegative().safe(),
  skipped: z.number().int().nonnegative().safe(),
  status: ciEvidenceStatusSchema,
  total: z.number().int().nonnegative().safe(),
  workflowName: z.string().trim().min(1).max(100).nullable(),
});

export type CiSummary = z.infer<typeof ciSummarySchema>;
/**
 * Truncates a string to at most maxBytes in UTF-8, preserving code point
 * boundaries and appending an ellipsis if truncation occurred.
 */
export function truncateUtf8Bytes(
  str: string,
  maxBytes: number,
  ellipsis = "…",
): string {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(str);
  if (encoded.length <= maxBytes) {
    return str;
  }

  const ellipsisBytes = encoder.encode(ellipsis);
  if (ellipsisBytes.length > maxBytes) {
    return "";
  }

  const availableBytes = maxBytes - ellipsisBytes.length;
  let byteCount = 0;
  let result = "";

  // Iterating with for..of iterates by Unicode code point, preventing split surrogate pairs
  for (const char of str) {
    const charBytes = encoder.encode(char).length;
    if (byteCount + charBytes > availableBytes) {
      break;
    }
    byteCount += charBytes;
    result += char;
  }

  return result + ellipsis;
}
