import type {
  FindingFingerprint,
  PrKey,
  ReconciledFinding,
  ReconciliationSummary,
  RunId,
  TrackedFinding,
} from "@holon/domain";
import { z } from "zod";

import { reviewFindingSchema } from "./review-finding.js";
import { reviewTextLimits } from "./review-limits.js";
import {
  gitShaSchema,
  positiveIntegerSchema,
  prKeySchema,
  repositoryPathSchema,
  runIdSchema,
  timestampSchema,
} from "./shared.js";

export const findingFingerprintSchema: z.ZodType<FindingFingerprint> = z
  .string()
  .regex(
    /^fp:[a-f0-9]{64}$/u,
    "Expected a canonical finding fingerprint (fp:<sha256>)",
  ) as z.ZodType<FindingFingerprint>;

export { findingStatusSchema } from "./finding-status.js";
import { findingStatusSchema } from "./finding-status.js";

export type { FindingStatus } from "@holon/domain";
export type {
  FindingFingerprint,
  ReconciledFinding,
  ReconciliationSummary,
  TrackedFinding,
};

export const trackedFindingSchema: z.ZodType<TrackedFinding> = z.strictObject({
  identityAmbiguous: z.boolean().optional(),
  evidenceFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  confidence: z.number().min(0).max(1),
  diagnostic: z.string().trim().min(30).max(reviewTextLimits.diagnostic),
  filePath: repositoryPathSchema,
  fingerprint: findingFingerprintSchema,
  firstSeenHeadSha: gitShaSchema,
  firstSeenRunId: runIdSchema as z.core.$ZodType<RunId>,
  githubCommentId: z.optional(positiveIntegerSchema),
  lastSeenHeadSha: gitShaSchema,
  lastSeenRunId: runIdSchema as z.core.$ZodType<RunId>,
  line: positiveIntegerSchema,
  prKey: prKeySchema as z.ZodType<PrKey>,
  severity: z.enum(["critical", "high", "medium", "low"]),
  status: findingStatusSchema,
  updatedAt: timestampSchema,
});

export const reconciliationSummarySchema: z.ZodType<ReconciliationSummary> =
  z.strictObject({
    unverifiedCount: z.number().int().nonnegative().optional(),
    dismissedCount: z.number().int().nonnegative(),
    newCount: z.number().int().nonnegative(),
    obsoleteCount: z.number().int().nonnegative(),
    persistentCount: z.number().int().nonnegative(),
    reintroducedCount: z.number().int().nonnegative(),
    resolvedCount: z.number().int().nonnegative(),
    totalActiveCount: z.number().int().nonnegative(),
  });

export const reconciledFindingSchema = z.strictObject({
  ...reviewFindingSchema.shape,
  identityAmbiguous: z.boolean().optional(),
  evidenceFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  fingerprint: findingFingerprintSchema,
  firstSeenHeadSha: gitShaSchema.optional(),
  previousCommentId: z.optional(positiveIntegerSchema),
  status: findingStatusSchema,
});
