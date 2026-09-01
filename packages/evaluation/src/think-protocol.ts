import { z } from "zod";

import { evalSubjectOutputSchema } from "./contracts.js";

const safeIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);

export const thinkEvaluationStartRequestSchema = z.strictObject({
  caseId: safeIdentifierSchema,
  evaluationRunId: safeIdentifierSchema,
  sourceRevision: safeIdentifierSchema,
});

export const thinkEvaluationStartResponseSchema = z.strictObject({
  agentName: z.string().regex(/^eval-[a-f0-9]{64}$/u),
  sourceRevision: safeIdentifierSchema,
  workflowId: z.string().trim().min(1).max(512),
});

export const thinkEvaluationStatusResponseSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({ status: z.enum(["queued", "running", "waiting"]) }),
    z.strictObject({
      result: evalSubjectOutputSchema,
      status: z.literal("complete"),
    }),
    z.strictObject({
      reason: z.enum([
        "model_output",
        "provider_permanent",
        "provider_transient",
        "tool_budget",
        "unknown",
      ]),
      status: z.literal("errored"),
    }),
  ],
);

export type ThinkEvaluationStartRequest = z.infer<
  typeof thinkEvaluationStartRequestSchema
>;
export type ThinkEvaluationStatusResponse = z.infer<
  typeof thinkEvaluationStatusResponseSchema
>;
