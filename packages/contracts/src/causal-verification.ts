import { z } from "zod";

import { reviewTextLimits } from "./review-limits.js";

/** A verifier may assess existing candidates, never emit or rewrite findings. */
export const causalVerificationSchema = z.strictObject({
  assessments: z
    .array(
      z.strictObject({
        candidateIndex: z
          .number()
          .int()
          .nonnegative()
          .max(reviewTextLimits.findings - 1),
        outcome: z.enum(["confirmed", "refuted", "inconclusive"]),
        confidence: z.number().min(0).max(1),
        rationale: z.string().trim().min(30).max(reviewTextLimits.diagnostic),
      }),
    )
    .max(reviewTextLimits.findings),
  summary: z.string().trim().min(1).max(reviewTextLimits.summary),
});

export type CausalVerification = z.infer<typeof causalVerificationSchema>;
