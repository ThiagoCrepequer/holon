import type { RunId } from "@holon/domain";
import { z } from "zod";

import { ciEvidenceStatusSchema } from "./ci-evidence.js";
import {
  findingFingerprintSchema,
  findingStatusSchema,
} from "./finding-lifecycle.js";
import { projectIdentificationResultV1Schema } from "./project-identification.js";
import { reviewTextLimits } from "./review-limits.js";
import { reviewScopeStatusSchema } from "./review-plan.js";
import { reviewVerdictSchema } from "./review-verdict.js";
import {
  gitShaSchema,
  positiveIntegerSchema,
  prKeySchema,
  repositoryPathSchema,
  runIdSchema,
  timestampSchema,
} from "./shared.js";
import {
  costAccountingSchema,
  stepTimingSchema,
  tokenAccountingSchema,
} from "./telemetry.js";
import { stepExecutionNodeSchema } from "./workflow-execution-preview.js";

const nonNegativeSafeIntegerSchema = z.number().int().nonnegative().safe();

export const adminFindingSummaryV1Schema = z.strictObject({
  diagnostic: z.string().min(1).max(reviewTextLimits.diagnostic),
  filePath: repositoryPathSchema,
  fingerprint: findingFingerprintSchema,
  line: positiveIntegerSchema,
  severity: z.enum(["critical", "high", "medium", "low"]),
  status: findingStatusSchema,
  updatedAt: timestampSchema,
});

export const adminCiSummaryV1Schema = z.strictObject({
  durationMs: nonNegativeSafeIntegerSchema.nullable(),
  failed: nonNegativeSafeIntegerSchema,
  passed: nonNegativeSafeIntegerSchema,
  skipped: nonNegativeSafeIntegerSchema,
  status: ciEvidenceStatusSchema,
  total: nonNegativeSafeIntegerSchema,
  workflowName: z.string().trim().min(1).max(100).nullable(),
});

export const adminRunDetailV2Schema = z.strictObject({
  projectIdentification: projectIdentificationResultV1Schema.nullable(),
  currentFindings: z.array(adminFindingSummaryV1Schema).max(100),
  findingsPerspective: z.literal("current_pr_state"),
  run: z.strictObject({
    cost: costAccountingSchema,
    headSha: gitShaSchema,
    isDegraded: z.boolean(),
    prKey: prKeySchema,
    runId: runIdSchema as z.ZodType<RunId>,
    scopeStatus: reviewScopeStatusSchema.nullable(),
    shardsCount: nonNegativeSafeIntegerSchema,
    stepTimings: z.array(stepTimingSchema).max(100),
    terminalState: z.enum(["completed", "failed_terminal", "obsolete"]),
    tokens: tokenAccountingSchema,
    toolCallsCount: nonNegativeSafeIntegerSchema,
    verdict: reviewVerdictSchema.nullable(),
  }),
  schemaVersion: z.literal(2),
  structuredCi: adminCiSummaryV1Schema.nullable(),
});

export const adminReadRequestV1Schema = z.strictObject({
  runId: runIdSchema as z.ZodType<RunId>,
});

export const adminCleanupTaskSummaryV1Schema = z.strictObject({
  attempts: nonNegativeSafeIntegerSchema,
  completedAt: timestampSchema.nullable(),
  nextAttemptAt: timestampSchema.nullable(),
  requestedAt: timestampSchema,
  state: z.enum(["pending", "completed"]),
});

export const adminRunDetailV3Schema = z.strictObject({
  cleanupTask: adminCleanupTaskSummaryV1Schema.nullable(),
  currentFindings: z.array(adminFindingSummaryV1Schema).max(100),
  findingsPerspective: z.enum(["current_pr_state", "historical_run", "both"]),
  graphSchemaVersion: z.literal(1),
  historicalRunFindings: z
    .array(adminFindingSummaryV1Schema)
    .max(100)
    .nullable(),
  projectIdentification: projectIdentificationResultV1Schema.nullable(),
  run: z.strictObject({
    cost: costAccountingSchema.nullable(),
    createdAt: timestampSchema.optional(),
    headSha: gitShaSchema,
    isDegraded: z.boolean(),
    prKey: prKeySchema,
    runId: runIdSchema as z.ZodType<RunId>,
    runState: z.enum([
      "queued",
      "running",
      "publishing",
      "completed",
      "failed_terminal",
      "obsolete",
    ]),
    scopeStatus: reviewScopeStatusSchema.nullable(),
    shardsCount: nonNegativeSafeIntegerSchema,
    stepTimings: z.array(stepTimingSchema).max(100),
    terminalState: z
      .enum(["completed", "failed_terminal", "obsolete"])
      .nullable(),
    tokens: tokenAccountingSchema.nullable(),
    toolCallsCount: nonNegativeSafeIntegerSchema,
    updatedAt: timestampSchema.nullable().optional(),
    verdict: reviewVerdictSchema.nullable(),
  }),
  schemaVersion: z.literal(3),
  stepExecutions: z.array(stepExecutionNodeSchema).max(100),
  structuredCi: adminCiSummaryV1Schema.nullable(),
});

export type AdminFindingSummaryV1 = z.infer<typeof adminFindingSummaryV1Schema>;
export type AdminCiSummaryV1 = z.infer<typeof adminCiSummaryV1Schema>;
export type AdminRunDetailV2 = z.infer<typeof adminRunDetailV2Schema>;
export type AdminRunDetailV3 = z.infer<typeof adminRunDetailV3Schema>;
export type AdminCleanupTaskSummaryV1 = z.infer<
  typeof adminCleanupTaskSummaryV1Schema
>;
export type AdminReadRequestV1 = z.infer<typeof adminReadRequestV1Schema>;

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
