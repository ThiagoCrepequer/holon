import { z } from "zod";

import {
  reconciledFindingSchema,
  trackedFindingSchema,
} from "./finding-lifecycle.js";
import { reviewOutputPreferencesSchema } from "./repository-config/input.js";
import { investigationObservationSchema } from "./repository-memory.js";
import { repositoryPolicySourceSchema } from "./repository-policy.js";
import { reviewExecutionLimits } from "./review-execution-limits.js";
import { reviewTextLimits } from "./review-limits.js";
import { aggregatedReviewResultSchema } from "./review-plan.js";
import { structuralImpactReportSchema } from "./structural-analysis.js";

export const reconciledReviewOutputSchema = aggregatedReviewResultSchema.extend(
  {
    investigations: z.array(investigationObservationSchema).max(256).optional(),
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

/** Only publication identifiers and bounded metadata cross a Workflow checkpoint. */
export const reviewAnalysisCheckpointSchema = reconciledReviewOutputSchema
  .omit({
    investigations: true,
    findings: true,
    activeFindings: true,
    resolvedFindings: true,
    updatedTrackedFindings: true,
    structuralImpact: true,
  })
  .extend({
    activeFindings: z
      .array(
        reconciledFindingSchema.pick({ fingerprint: true, severity: true }),
      )
      .max(reviewExecutionLimits.maxShards * reviewTextLimits.findings),
    resolvedFindingsCount: z
      .number()
      .int()
      .nonnegative()
      .max(reviewExecutionLimits.maxShards * reviewTextLimits.findings),
  });
export type ReviewAnalysisCheckpoint = z.infer<
  typeof reviewAnalysisCheckpointSchema
>;
export function buildReviewAnalysisCheckpoint(
  output: ReconciledReviewOutput,
): ReviewAnalysisCheckpoint {
  const {
    investigations: _investigations,
    findings: _findings,
    activeFindings,
    resolvedFindings,
    updatedTrackedFindings: _tracked,
    structuralImpact: _impact,
    ...metadata
  } = output;
  return reviewAnalysisCheckpointSchema.parse({
    ...metadata,
    activeFindings: activeFindings.map(({ fingerprint, severity }) => ({
      fingerprint,
      severity,
    })),
    resolvedFindingsCount: resolvedFindings.length,
  });
}
