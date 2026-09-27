import { z } from "zod";

import { adminCiSummarySchema } from "./admin-run-detail.js";
import { positiveIntegerSchema } from "./shared.js";
export const ciPublicationTargetSchema = z.strictObject({
  installationId: positiveIntegerSchema,
  repositoryId: positiveIntegerSchema,
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
  pullNumber: positiveIntegerSchema,
});
export const savedCiEvidenceSchema = z.strictObject({
  markdown: z.string().max(16000),
  workflowRunId: positiveIntegerSchema,
  workflowRunAttempt: positiveIntegerSchema,
  structuredCi: adminCiSummarySchema.nullish(),
  target: ciPublicationTargetSchema,
});
export type SavedCiEvidence = z.infer<typeof savedCiEvidenceSchema>;
