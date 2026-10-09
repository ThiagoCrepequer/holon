import { z } from "zod";

import { reviewTextLimits } from "./review-limits.js";

/** A verifier may assess existing candidates, never emit or rewrite findings. */
export const causalVerificationSchema = z.strictObject({
  assessments: z
    .array(
      z
        .strictObject({
          candidateIndex: z
            .number()
            .int()
            .nonnegative()
            .max(reviewTextLimits.findings - 1),
          basis: z.enum(["patch", "repository"]),
          evidenceReceiptIds: z
            .array(
              z
                .string()
                .regex(/^[a-f0-9]{64}$/u)
                .describe(
                  "Select a complete host-issued receipt ID exactly. The host resolves its immutable inspected window; never invent or shorten IDs.",
                ),
            )
            .max(8),
          outcome: z.enum(["confirmed", "refuted", "inconclusive"]),
          confidence: z.number().min(0).max(1),
          rationale: z.string().trim().min(30).max(reviewTextLimits.diagnostic),
        })
        .refine(
          (value) =>
            value.basis === "patch"
              ? value.evidenceReceiptIds.length === 0
              : value.evidenceReceiptIds.length > 0,
          "Repository premises require inspected receipt IDs",
        ),
    )
    .max(reviewTextLimits.findings),
  summary: z.string().trim().min(1).max(reviewTextLimits.summary),
});

export type CausalVerification = z.infer<typeof causalVerificationSchema>;
