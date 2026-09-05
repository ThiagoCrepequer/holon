import type { RunId } from "@holon/domain";
import { z } from "zod";

import { ciEvidenceStatusSchema } from "./ci-evidence.js";
import {
  findingFingerprintSchema,
  findingStatusSchema,
} from "./finding-lifecycle.js";
import { projectIdentificationResultV1Schema } from "./project-identification.js";
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

const nonNegativeSafeIntegerSchema = z.number().int().nonnegative().safe();

export const adminFindingSummaryV1Schema = z.strictObject({
  diagnostic: z.string().min(1).max(512),
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

export const adminRunDetailV1Schema = z.strictObject({
  projectIdentification: projectIdentificationResultV1Schema
    .nullable()
    .optional(),
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
  schemaVersion: z.literal(1),
  structuredCi: adminCiSummaryV1Schema.nullable(),
});

export const adminRunDetailV2Schema = adminRunDetailV1Schema.extend({
  schemaVersion: z.literal(2),
  projectIdentification: projectIdentificationResultV1Schema.nullable(),
});
export type AdminRunDetailV2 = z.infer<typeof adminRunDetailV2Schema>;

export const adminReadRequestV1Schema = z.strictObject({
  runId: runIdSchema as z.ZodType<RunId>,
});

export type AdminFindingSummaryV1 = z.infer<typeof adminFindingSummaryV1Schema>;
export type AdminCiSummaryV1 = z.infer<typeof adminCiSummaryV1Schema>;
export type AdminRunDetailV1 = z.infer<typeof adminRunDetailV1Schema>;
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
