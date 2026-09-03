import { z } from "zod";

import { runStateSchema } from "./review-output.js";
import { reviewScopeStatusSchema } from "./review-plan.js";
import { reviewVerdictSchema } from "./review-verdict.js";

export const stepTimingSchema = z.strictObject({
  attempt: z.number().int().positive().default(1),
  durationMs: z.number().int().nonnegative(),
  status: z.enum(["success", "failure"]),
  stepName: z.string().min(1).max(100),
});

export const tokenAccountingSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative(),
});

export const costAccountingSchema = z.strictObject({
  currency: z.literal("USD"),
  estimatedCostMicroUsd: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
  pricingModel: z.string().min(1).max(100),
});

export const runTelemetrySchema = z.strictObject({
  cost: costAccountingSchema,
  createdAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative(),
  headSha: z.string().regex(/^[0-9a-f]{40}$/u),
  isDegraded: z.boolean(),
  prKey: z.string().min(1).max(200),
  queueWaitMs: z.number().int().nonnegative(),
  runId: z.string().min(1).max(256),
  scopeStatus: reviewScopeStatusSchema,
  shardsCount: z.number().int().nonnegative(),
  stepTimings: z.array(stepTimingSchema),
  terminalState: runStateSchema,
  tokens: tokenAccountingSchema,
  toolCallsCount: z.number().int().nonnegative(),
  verdict: reviewVerdictSchema.optional(),
});

export const healthCheckReportSchema = z.strictObject({
  checks: z.strictObject({
    aiGateway: z.boolean(),
    database: z.boolean(),
    executor: z.boolean(),
  }),
  diagnostics: z.array(z.string().min(1).max(300)).optional(),
  status: z.enum(["ok", "degraded", "error"]),
  timestamp: z.string().datetime(),
  version: z.string().min(1).max(50),
});

export type StepTiming = z.infer<typeof stepTimingSchema>;
export type TokenAccounting = z.infer<typeof tokenAccountingSchema>;
export type CostAccounting = z.infer<typeof costAccountingSchema>;
export type RunTelemetry = z.infer<typeof runTelemetrySchema>;
export type HealthCheckReport = z.infer<typeof healthCheckReportSchema>;
