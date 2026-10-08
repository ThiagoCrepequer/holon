import { z } from "zod";

import {
  changedLinesSchema,
  reviewContextFileSchema,
  reviewSurfaceSchema,
} from "./executor.js";
import { reconciliationSummarySchema } from "./finding-lifecycle.js";
import { investigationObservationSchema } from "./repository-memory.js";
import { reviewExecutionLimits } from "./review-execution-limits.js";
import { reviewTextLimits } from "./review-limits.js";
import { reviewOutputLimitationsSchema } from "./review-output.js";
import { reviewFindingSchema } from "./review-output.js";
import { reviewResolutionSchema } from "./review-output.js";
import {
  reviewVerdictDetailsSchema,
  reviewVerdictSchema,
} from "./review-verdict.js";

export const reviewScopeStatusSchema = z.enum([
  "complete",
  "partial_by_policy",
  "partial_by_failure",
  "unsupported",
]);

export const reviewShardSchema = z.strictObject({
  byteLength: z.number().int().nonnegative(),
  changedLines: changedLinesSchema,
  files: z.array(reviewContextFileSchema).min(1).max(50),
  id: z.string().min(1).max(100),
  index: z.number().int().nonnegative(),
  surface: reviewSurfaceSchema,
  totalShards: z.number().int().positive(),
});

export const reviewPlanOmissionSchema = z.discriminatedUnion("code", [
  z.strictObject({
    code: z.literal("all_excluded"),
    count: z.number().int().nonnegative(),
  }),
  z.strictObject({ code: z.literal("unsupported") }),
  z.strictObject({
    code: z.literal("oversized_patches"),
    count: z.number().int().nonnegative(),
    bytes: z.number().int().positive(),
  }),
  z.strictObject({
    code: z.literal("file_limit"),
    count: z.number().int().nonnegative(),
  }),
  z.strictObject({
    code: z.literal("policy_excluded"),
    count: z.number().int().nonnegative(),
  }),
  z.strictObject({
    code: z.literal("shard_limit"),
    maximum: z.number().int().positive(),
    planned: z.number().int().positive(),
  }),
  z.strictObject({ code: z.literal("executor_budget") }),
  z.strictObject({
    code: z.literal("contract_checks"),
    count: z.number().int().positive(),
  }),
]);
export type ReviewPlanOmission = z.infer<typeof reviewPlanOmissionSchema>;
export const reviewPlanSchema = z.strictObject({
  omissionReasons: z.array(reviewPlanOmissionSchema),
  scopeStatus: reviewScopeStatusSchema,
  shards: z.array(reviewShardSchema).max(reviewExecutionLimits.maxShards),
  totalEligibleBytes: z.number().int().nonnegative(),
  totalEligibleFiles: z.number().int().nonnegative(),
  totalEligibleLines: z.number().int().nonnegative(),
  unsupportedFilesCount: z.number().int().nonnegative(),
});

export const shardReviewResultSchema = z.strictObject({
  investigations: z.array(investigationObservationSchema).max(4).optional(),
  resolutions: z.array(reviewResolutionSchema).max(8).optional(),
  errorReason: z.string().optional(),
  findings: z.array(reviewFindingSchema),
  isDegraded: z.boolean().optional(),
  outputLimitations: reviewOutputLimitationsSchema.optional(),
  shardId: z.string().min(1).max(100),
  shardIndex: z.number().int().nonnegative(),
  status: z.enum(["success", "failure"]),
  summary: z.string().trim().max(reviewTextLimits.summary),
});

export const aggregatedReviewResultSchema = z.strictObject({
  findings: z.array(reviewFindingSchema),
  isDegraded: z.boolean().optional(),
  omissionReasons: z.array(z.string().min(1).max(300)),
  scopeStatus: reviewScopeStatusSchema,
  shardsAnalyzed: z.number().int().nonnegative(),
  summary: z.string().trim().max(reviewTextLimits.publicationSummary),
  totalShards: z.number().int().nonnegative(),
  reconciliation: reconciliationSummarySchema.optional(),
  verdict: reviewVerdictSchema.optional(),
  verdictDetails: reviewVerdictDetailsSchema.optional(),
});

export type ReviewScopeStatus = z.infer<typeof reviewScopeStatusSchema>;
export type ReviewShard = z.infer<typeof reviewShardSchema>;
export type ReviewPlan = z.infer<typeof reviewPlanSchema>;
export type ShardReviewResult = z.infer<typeof shardReviewResultSchema>;
export type AggregatedReviewResult = z.infer<
  typeof aggregatedReviewResultSchema
>;
