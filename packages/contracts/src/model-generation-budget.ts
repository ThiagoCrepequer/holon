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
    phase: z.enum([
      "investigation",
      "causal_verification",
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
