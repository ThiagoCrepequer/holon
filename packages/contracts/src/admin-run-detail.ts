import type { RunId } from "@holon/domain";
import { z } from "zod";

import { ciEvidenceStatusSchema } from "./ci-evidence.js";
import {
  findingFingerprintSchema,
  findingStatusSchema,
} from "./finding-lifecycle.js";
import { projectIdentificationResultSchema } from "./project-identification.js";
import { runConfigurationSummarySchema } from "./repository-config/snapshot.js";
import { reviewTextLimits } from "./review-limits.js";
import { reviewFindingSchema } from "./review-output.js";
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

export const adminFindingSummarySchema = z.strictObject({
  details: reviewFindingSchema
    .pick({ confidence: true, suggestion: true, evidence: true })
    .optional(),
  identityAmbiguous: z.boolean().optional(),
  diagnostic: z.string().min(1).max(reviewTextLimits.diagnostic),
  filePath: repositoryPathSchema,
  fingerprint: findingFingerprintSchema,
  line: positiveIntegerSchema,
  severity: z.enum(["critical", "high", "medium", "low"]),
  status: findingStatusSchema,
  updatedAt: timestampSchema,
});

export const adminCiSummarySchema = z.strictObject({
  durationMs: nonNegativeSafeIntegerSchema.nullable(),
  failed: nonNegativeSafeIntegerSchema,
  passed: nonNegativeSafeIntegerSchema,
  skipped: nonNegativeSafeIntegerSchema,
  status: ciEvidenceStatusSchema,
  total: nonNegativeSafeIntegerSchema,
  workflowName: z.string().trim().min(1).max(100).nullable(),
});

export const adminReadRequestSchema = z.strictObject({
  runId: runIdSchema as z.ZodType<RunId>,
});

export const adminCleanupTaskSummarySchema = z.strictObject({
  attempts: nonNegativeSafeIntegerSchema,
  completedAt: timestampSchema.nullable(),
  nextAttemptAt: timestampSchema.nullable(),
  requestedAt: timestampSchema,
  state: z.enum(["pending", "completed"]),
});

export const adminRunDetailSchema = z.strictObject({
  configuration: runConfigurationSummarySchema.nullable(),
  cleanupTask: adminCleanupTaskSummarySchema.nullable(),
  currentFindings: z.array(adminFindingSummarySchema).max(100),
  findingsPerspective: z.enum(["current_pr_state", "historical_run", "both"]),
  historicalRunFindings: z.array(adminFindingSummarySchema).max(100).nullable(),
  projectIdentification: projectIdentificationResultSchema.nullable(),
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
  stepExecutions: z.array(stepExecutionNodeSchema).max(100),
  structuredCi: adminCiSummarySchema.nullable(),
});

export type AdminFindingSummary = z.infer<typeof adminFindingSummarySchema>;
export type AdminCiSummary = z.infer<typeof adminCiSummarySchema>;

export type AdminRunDetail = z.infer<typeof adminRunDetailSchema>;
export type AdminCleanupTaskSummary = z.infer<
  typeof adminCleanupTaskSummarySchema
>;
export type AdminReadRequest = z.infer<typeof adminReadRequestSchema>;

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
