import { z } from "zod";

/** Aggregate admission ceilings, not a monetary billing estimate. */
export const modelGenerationLimits = {
  calls: 64,
  inputBytes: 4_000_000,
  outputTokens: 120_000,
} as const;
export const modelGenerationReservationSchema = z
  .object({
    shardIndex: z.number().int().min(0).max(63),
    shardCount: z.number().int().min(1).max(64),
    phase: z.enum(["investigation", "finalization", "recovery", "synthesis"]),
    inputBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    outputTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type ModelGenerationReservation = z.infer<
  typeof modelGenerationReservationSchema
>;

export type ModelGenerationAdmission =
  | {
      readonly accepted: true;
      readonly id: number;
      readonly outputTokens: number;
    }
  | {
      readonly accepted: false;
      readonly reason: "calls" | "input_bytes" | "output_tokens";
      readonly limit: number;
      readonly consumed: number;
      readonly requested: number;
    };
export function modelShardAllocation(
  shardCount: number,
  investigation: boolean,
) {
  const calls = Math.floor(modelGenerationLimits.calls / shardCount);
  const inputBytes = Math.floor(modelGenerationLimits.inputBytes / shardCount);
  const outputTokens = Math.floor(
    modelGenerationLimits.outputTokens / shardCount,
  );
  return {
    calls: Math.max(0, calls - (investigation ? 2 : 0)),
    inputBytes:
      inputBytes -
      (investigation ? Math.min(128_000, Math.floor(inputBytes / 2)) : 0),
    outputTokens:
      outputTokens -
      (investigation ? Math.min(8192, Math.floor(outputTokens * 0.6)) : 0),
  };
}
