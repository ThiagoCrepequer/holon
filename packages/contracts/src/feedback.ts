import type {
  FeedbackLabel,
  FindingFeedbackRecord,
  ParsedFeedbackCommand,
  PrKey,
} from "@holon/domain";
import { z } from "zod";

import { findingFingerprintSchema } from "./finding-lifecycle.js";
import {
  positiveIntegerSchema,
  prKeySchema,
  repositoryPathSchema,
  timestampSchema,
} from "./shared.js";

export const feedbackLabelSchema: z.ZodType<FeedbackLabel> = z.enum([
  "helpful",
  "false_positive",
  "wrong_severity",
  "duplicate",
  "not_actionable",
  "missed_defect",
  "thread_resolved",
]);

export type { FeedbackLabel, FindingFeedbackRecord, ParsedFeedbackCommand };

export const findingFeedbackRecordSchema: z.ZodType<FindingFeedbackRecord> =
  z.strictObject({
    authorAssociation: z.string().trim().max(50).optional(),
    authorLogin: z.string().trim().min(1).max(100),
    createdAt: timestampSchema,
    fingerprint: findingFingerprintSchema,
    githubCommentId: z.optional(positiveIntegerSchema),
    id: z.optional(positiveIntegerSchema),
    label: feedbackLabelSchema,
    prKey: prKeySchema as z.ZodType<PrKey>,
    reason: z.string().trim().max(1000).optional(),
    targetSeverity: z.enum(["critical", "high", "medium", "low"]).optional(),
  });

export const parsedFeedbackCommandSchema: z.ZodType<ParsedFeedbackCommand> =
  z.strictObject({
    label: feedbackLabelSchema,
    line: z.optional(positiveIntegerSchema),
    path: z.optional(repositoryPathSchema),
    reason: z.string().trim().max(1000).optional(),
    targetSeverity: z.enum(["critical", "high", "medium", "low"]).optional(),
  });

export interface CalibrationMetrics {
  readonly adjudicatedFindings: number;
  readonly conflictedFindings: number;
  readonly resolvedFindings: number;
  readonly falsePositiveCount: number;
  readonly falsePositiveRate: number | null;
  readonly helpfulCount: number;
  readonly totalFeedbacks: number;
  readonly totalReviewedFindings: number;
  readonly utilityRate: number | null;
  readonly wrongSeverityCount: number;
}

export const calibrationMetricsSchema: z.ZodType<CalibrationMetrics> =
  z.strictObject({
    adjudicatedFindings: z.number().int().nonnegative(),
    conflictedFindings: z.number().int().nonnegative(),
    resolvedFindings: z.number().int().nonnegative(),
    falsePositiveCount: z.number().int().nonnegative(),
    falsePositiveRate: z.number().min(0).max(1).nullable(),
    helpfulCount: z.number().int().nonnegative(),
    totalFeedbacks: z.number().int().nonnegative(),
    totalReviewedFindings: z.number().int().nonnegative(),
    utilityRate: z.number().min(0).max(1).nullable(),
    wrongSeverityCount: z.number().int().nonnegative(),
  });
