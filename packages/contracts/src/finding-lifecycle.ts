import type {
  FindingFingerprint,
  FindingStatus,
  PrKey,
  ReconciledFinding,
  ReconciliationSummary,
  RunId,
  TrackedFinding,
} from "@holon/domain";
import { z } from "zod";

import { reviewFindingSchema } from "./review-output.js";
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

export const findingStatusSchema: z.ZodType<FindingStatus> = z.enum([
  "new",
  "persistent",
  "resolved",
  "obsolete",
  "reintroduced",
]);

export type {
  FindingFingerprint,
  FindingStatus,
  ReconciledFinding,
  ReconciliationSummary,
  TrackedFinding,
};

export const trackedFindingSchema: z.ZodType<TrackedFinding> = z.strictObject({
  diagnostic: z.string().trim().min(30).max(600),
  filePath: repositoryPathSchema,
  fingerprint: findingFingerprintSchema,
  firstSeenHeadSha: gitShaSchema,
  firstSeenRunId: runIdSchema as z.ZodType<RunId>,
  githubCommentId: positiveIntegerSchema.optional(),
  lastSeenHeadSha: gitShaSchema,
  lastSeenRunId: runIdSchema as z.ZodType<RunId>,
  line: positiveIntegerSchema,
  prKey: prKeySchema as z.ZodType<PrKey>,
  severity: z.enum(["critical", "high", "medium", "low"]),
  status: findingStatusSchema,
  updatedAt: timestampSchema,
});

export const reconciliationSummarySchema = z.strictObject({
  newCount: z.number().int().nonnegative(),
  obsoleteCount: z.number().int().nonnegative(),
  persistentCount: z.number().int().nonnegative(),
  reintroducedCount: z.number().int().nonnegative(),
  resolvedCount: z.number().int().nonnegative(),
  totalActiveCount: z.number().int().nonnegative(),
});

export const reconciledFindingSchema = reviewFindingSchema.extend({
  fingerprint: findingFingerprintSchema,
  firstSeenHeadSha: gitShaSchema.optional(),
  previousCommentId: positiveIntegerSchema.optional(),
  status: findingStatusSchema,
});
