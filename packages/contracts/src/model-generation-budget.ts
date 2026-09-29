import { z } from "zod";

/** Aggregate admission ceilings, not a monetary billing estimate. */
export const modelGenerationLimits = {
  calls: 64,
  inputBytes: 4_000_000,
  outputTokens: 120_000,
} as const;
export const modelGenerationReservationSchema = z
  .object({
    inputBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    outputTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type ModelGenerationReservation = z.infer<
  typeof modelGenerationReservationSchema
>;
