import { z } from "zod";

import {
  reconciledFindingSchema,
  trackedFindingSchema,
} from "./finding-lifecycle.js";
import { reviewOutputPreferencesSchema } from "./repository-config/input.js";
import { repositoryPolicySourceSchema } from "./repository-policy.js";
import { limitReviewText } from "./review-limits.js";
import { aggregatedReviewResultSchema } from "./review-plan.js";
import { structuralImpactReportSchema } from "./structural-analysis.js";
import { stepTimingSchema } from "./telemetry.js";

export const analysisUsageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  toolCallsCount: z.number().int().nonnegative(),
});
export const analysisAccountingSchema = analysisUsageSchema.extend({
  stepTimings: z.array(stepTimingSchema),
});
export type AnalysisUsage = z.infer<typeof analysisUsageSchema>;
export type AnalysisAccounting = z.infer<typeof analysisAccountingSchema>;

export const reconciledReviewOutputSchema = aggregatedReviewResultSchema.extend(
  {
    output: reviewOutputPreferencesSchema,
    analysisIsDegraded: z.boolean().optional(),
    verdictPolicy: z
      .strictObject({ mediumSeverityThreshold: z.number().int().positive() })
      .optional(),
    activeFindings: z.array(reconciledFindingSchema),
    resolvedFindings: z.array(trackedFindingSchema),
    updatedTrackedFindings: z.array(trackedFindingSchema),
    effectivePolicyDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    sourceDigest: z.string().nullable().optional(),
    policySource: repositoryPolicySourceSchema.optional(),
    promptTruncated: z.boolean().optional(),
    contextTruncated: z.boolean().optional(),
    structuralImpact: structuralImpactReportSchema.optional(),
    waiversCount: z.number().int().nonnegative().optional(),
  },
);
export type ReconciledReviewOutput = z.infer<
  typeof reconciledReviewOutputSchema
>;

/** Only publication coordinates and bounded metadata cross a Workflow checkpoint. */
export const reviewAnalysisCheckpointSchema = reconciledReviewOutputSchema
  .omit({
    findings: true,
    activeFindings: true,
    resolvedFindings: true,
    updatedTrackedFindings: true,
    structuralImpact: true,
  })
  .extend({
    activeFindings: z
      .array(
        reconciledFindingSchema
          .pick({
            identityAmbiguous: true,
            confidence: true,
            fingerprint: true,
            location: true,
            severity: true,
            status: true,
            previousCommentId: true,
          })
          .extend({ diagnostic: z.string().max(300) }),
      )
      .max(40),
    resolvedFindingsCount: z.number().int().nonnegative().max(40),
  });
export type ReviewAnalysisCheckpoint = z.infer<
  typeof reviewAnalysisCheckpointSchema
>;
export function buildReviewAnalysisCheckpoint(
  output: ReconciledReviewOutput,
): ReviewAnalysisCheckpoint {
  const {
    findings: _findings,
    activeFindings,
    resolvedFindings,
    updatedTrackedFindings: _tracked,
    structuralImpact: _impact,
    ...metadata
  } = output;
  return reviewAnalysisCheckpointSchema.parse({
    ...metadata,
    activeFindings: activeFindings.map(
      ({
        identityAmbiguous,
        confidence,
        fingerprint,
        location,
        severity,
        status,
        previousCommentId,
        diagnostic,
      }) => ({
        identityAmbiguous,
        confidence,
        fingerprint,
        location,
        severity,
        status,
        previousCommentId,
        diagnostic: limitReviewText(diagnostic, 300),
      }),
    ),
    resolvedFindingsCount: resolvedFindings.length,
  });
}
