import { z } from "zod";

/** Aggregate admission ceilings, not a monetary billing estimate. */
export const modelGenerationLimits = {
  calls: 64,
  inputBytes: 4_000_000,
  outputTokens: 120_000,
} as const;
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
export const maximumBudgetedReviewShards = Math.floor(
  modelGenerationLimits.calls / reviewGenerationCallsPerShard,
);

/** A shard cannot consume the allocation of another admitted shard. */
export function modelGenerationShardLimits(shardCount: number) {
  if (!Number.isSafeInteger(shardCount) || shardCount < 1 || shardCount > 64)
    throw new RangeError("Invalid model shard count");
  return {
    calls: Math.floor(modelGenerationLimits.calls / shardCount),
    inputBytes: Math.floor(modelGenerationLimits.inputBytes / shardCount),
    outputTokens: Math.floor(modelGenerationLimits.outputTokens / shardCount),
  };
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
