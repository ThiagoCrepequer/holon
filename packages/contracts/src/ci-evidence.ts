import { z } from "zod";

import { repositoryPathSchema } from "./shared.js";

export const lineCoverageSchema = z.strictObject({
  hitsByLine: z.record(z.string(), z.number().int().nonnegative()),
  path: repositoryPathSchema,
  totalFound: z.number().int().nonnegative(),
  totalHit: z.number().int().nonnegative(),
});

export const testFailureSchema = z.strictObject({
  filePath: repositoryPathSchema.optional(),
  line: z.number().int().positive().optional(),
  message: z.string().max(4_000),
  testName: z.string().min(1).max(300),
});

export const testExecutionReportSchema = z.strictObject({
  durationMs: z.number().nonnegative().optional(),
  failed: z.number().int().nonnegative(),
  failures: z.array(testFailureSchema).max(50),
  passed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const ciEvidenceStatusSchema = z.enum([
  "available",
  "partial",
  "not_available",
]);

export const ciEvidenceSchema = z.strictObject({
  limitations: z.array(z.string().max(300)).max(10).optional(),
  coverage: z.array(lineCoverageSchema).optional(),
  source: z.string().max(100).optional(),
  status: ciEvidenceStatusSchema,
  tests: testExecutionReportSchema.optional(),
  workflowName: z.string().max(200).optional(),
  workflowRunId: z.number().int().positive().optional(),
});

export type LineCoverage = z.infer<typeof lineCoverageSchema>;
export type TestFailure = z.infer<typeof testFailureSchema>;
export type TestExecutionReport = z.infer<typeof testExecutionReportSchema>;
export type CiEvidenceStatus = z.infer<typeof ciEvidenceStatusSchema>;
export type CiEvidence = z.infer<typeof ciEvidenceSchema>;
