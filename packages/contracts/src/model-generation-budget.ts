import { z } from "zod";

/** Bound the complete shard lifecycle, including optional causal and narrative turns. */
export const reviewGenerationSteps = {
  investigation: 4,
  causalVerification: 2,
  summaryRecovery: 1,
} as const;
export const reviewGenerationCallsPerShard =
  reviewGenerationSteps.investigation +
  reviewGenerationSteps.causalVerification +
  reviewGenerationSteps.summaryRecovery;
/** Fixed profiles bound cumulative inference input, including repeated history. */
export const reviewBudgetProfiles = {
  normal: {
    calls: 64,
    inputBytes: 4_000_000,
    outputTokens: 120_000,
    toolCalls: 96,
  },
  large: {
    calls: 192,
    inputBytes: 12_000_000,
    outputTokens: 360_000,
    toolCalls: 288,
  },
  very_large: {
    calls: 512,
    inputBytes: 32_000_000,
    outputTokens: 960_000,
    toolCalls: 768,
  },
} as const;

export const reviewBudgetPlanSchema = z
  .object({
    profile: z.enum(["normal", "large", "very_large"]),
    estimatedInputBytes: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    shardWeights: z.array(z.number().int().min(1).max(4)).min(1).max(64),
  })
  .strict()
  .refine((plan) => {
    const minimum = selectReviewBudgetProfile(
      plan.shardWeights.length,
      plan.estimatedInputBytes,
    );
    return (
      Object.keys(reviewBudgetProfiles).indexOf(plan.profile) >=
      Object.keys(reviewBudgetProfiles).indexOf(minimum)
    );
  }, "Review profile does not cover the planned work");
export type ReviewBudgetPlan = z.infer<typeof reviewBudgetPlanSchema>;

export function selectReviewBudgetProfile(
  shardCount: number,
  estimatedInputBytes = 0,
): keyof typeof reviewBudgetProfiles {
  if (
    !Number.isSafeInteger(shardCount) ||
    shardCount < 1 ||
    shardCount > 64 ||
    !Number.isSafeInteger(estimatedInputBytes) ||
    estimatedInputBytes < 0
  )
    throw new RangeError("Invalid review budget plan");
  if (
    shardCount > 24 ||
    estimatedInputBytes > reviewBudgetProfiles.large.inputBytes
  )
    return "very_large";
  if (
    shardCount > 9 ||
    estimatedInputBytes > reviewBudgetProfiles.normal.inputBytes
  )
    return "large";
  return "normal";
}

export function createReviewBudgetPlan(
  shardCount: number,
  estimatedInputBytes = 0,
  shardWeights?: readonly number[],
): ReviewBudgetPlan {
  const profile = selectReviewBudgetProfile(shardCount, estimatedInputBytes);
  shardWeights ??= Array.from({ length: shardCount }, () => 1);
  if (shardWeights.length !== shardCount)
    throw new RangeError("Invalid review shard weights");
  return reviewBudgetPlanSchema.parse({
    profile,
    estimatedInputBytes,
    shardWeights,
  });
}

/** Protect investigation first; distribute the remaining capacity by bounded risk weight. */
export function reviewShardBudget(plan: ReviewBudgetPlan, shardIndex: number) {
  const count = plan.shardWeights.length;
  const weight = plan.shardWeights[shardIndex];
  if (weight === undefined) throw new RangeError("Invalid review shard index");
  const limits = reviewBudgetProfiles[plan.profile];
  const weightTotal = plan.shardWeights.reduce((sum, item) => sum + item, 0);
  const protectedBudget = {
    calls: reviewGenerationSteps.investigation,
    inputBytes: Math.floor((limits.inputBytes * 0.7) / count),
    outputTokens: Math.floor((limits.outputTokens * 0.7) / count),
    toolCalls: 3,
  };
  const allocate = (ceiling: number, protectedLimit: number) =>
    protectedLimit +
    Math.floor(((ceiling - protectedLimit * count) * weight) / weightTotal);
  const allocation = {
    calls: allocate(limits.calls, protectedBudget.calls),
    inputBytes: allocate(limits.inputBytes, protectedBudget.inputBytes),
    outputTokens: allocate(limits.outputTokens, protectedBudget.outputTokens),
    toolCalls: allocate(limits.toolCalls, protectedBudget.toolCalls),
  };
  return { protectedBudget, allocation };
}

export const modelGenerationReservationSchema = z
  .object({
    shardIndex: z.number().int().min(0).max(63),
    shardCount: z.number().int().min(1).max(64),
    phase: z.enum([
      "investigation",
      "causal_verification",
      "finding_clarification",
      "finalization",
      "recovery",
      "synthesis",
    ]),
    inputBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    outputTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type ModelGenerationReservation = z.infer<
  typeof modelGenerationReservationSchema
>;

/** First denied dimension stops admission of subsequent shard waves. */
export const modelGenerationStopReasonSchema = z.enum([
  "calls",
  "input_bytes",
  "output_tokens",
]);
export type ModelGenerationStopReason = z.infer<
  typeof modelGenerationStopReasonSchema
>;

export type ModelGenerationAdmission =
  | {
      readonly accepted: true;
      readonly id: number;
      readonly outputTokens: number;
    }
  | {
      readonly accepted: false;
      readonly reason:
        | ModelGenerationStopReason
        | "shard_calls"
        | "shard_input_bytes"
        | "shard_output_tokens";
      readonly limit: number;
      readonly consumed: number;
      readonly requested: number;
    };
