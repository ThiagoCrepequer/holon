import { z } from "zod";

export const reviewVerdictSchema = z.enum([
  "APPROVE",
  "REQUEST_CHANGES",
  "COMMENT",
]);

export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;

export const reviewVerdictDetailsSchema = z.strictObject({
  advisoryFindingsCount: z.number().int().nonnegative(),
  blockingFindingsCount: z.number().int().nonnegative(),
  reasons: z.array(z.string().min(1).max(500)),
  riskScore: z.number().nonnegative(),
  verdict: reviewVerdictSchema,
});

export type ReviewVerdictDetails = z.infer<typeof reviewVerdictDetailsSchema>;

export const reviewVerdictPolicyOptionsSchema = z.strictObject({
  allowApprove: z.boolean().optional(),
  blockingSeverities: z
    .array(z.enum(["critical", "high", "medium", "low"]))
    .optional(),
  mediumHighConfidenceThreshold: z.number().min(0).max(1).optional(),
  mediumSeverityThreshold: z.number().int().positive().optional(),
  minimumConfidenceThreshold: z.number().min(0).max(1).optional(),
  riskScoreThreshold: z.number().positive().optional(),
});

export type ReviewVerdictPolicyOptions = z.infer<
  typeof reviewVerdictPolicyOptionsSchema
>;
