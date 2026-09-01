import { z } from "zod";

import {
  gitShaSchema,
  positiveIntegerSchema,
  runIdSchema,
  timestampSchema,
} from "./shared.js";

export const checkRunStatusSchema = z.enum([
  "queued",
  "in_progress",
  "completed",
]);
export type CheckRunStatus = z.infer<typeof checkRunStatusSchema>;

export const checkRunConclusionSchema = z.enum([
  "action_required",
  "cancelled",
  "failure",
  "neutral",
  "skipped",
  "stale",
  "success",
  "timed_out",
]);
export type CheckRunConclusion = z.infer<typeof checkRunConclusionSchema>;

export const checkRunOutputSchema = z.object({
  summary: z.string().min(1),
  text: z.string().optional(),
  title: z.string().min(1),
});
export type CheckRunOutput = z.infer<typeof checkRunOutputSchema>;

export const createCheckRunInputSchema = z.object({
  completedAt: timestampSchema.optional(),
  conclusion: checkRunConclusionSchema.optional(),
  externalId: runIdSchema,
  headSha: gitShaSchema,
  name: z.string().min(1).optional(),
  output: checkRunOutputSchema.optional(),
  startedAt: timestampSchema.optional(),
  status: checkRunStatusSchema,
});
export type CreateCheckRunInput = z.infer<typeof createCheckRunInputSchema>;

export const updateCheckRunInputSchema = z.object({
  checkRunId: positiveIntegerSchema,
  completedAt: timestampSchema.optional(),
  conclusion: checkRunConclusionSchema.optional(),
  output: checkRunOutputSchema.optional(),
  startedAt: timestampSchema.optional(),
  status: checkRunStatusSchema.optional(),
});
export type UpdateCheckRunInput = z.infer<typeof updateCheckRunInputSchema>;
