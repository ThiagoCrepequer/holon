import { z } from "zod";

import {
  gitShaSchema,
  nonNegativeIntegerSchema,
  positiveIntegerSchema,
  prKeySchema,
  repositoryPathSchema,
  runIdSchema,
  timestampSchema,
} from "./shared.js";

export const stepAttemptStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "interrupted",
]);

export const stepExecutionStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "obsolete",
  "skipped",
]);

export const stepPhaseSchema = z.enum([
  "admission",
  "preparation",
  "analysis",
  "publication",
  "cleanup",
]);

export const stepAttemptTelemetrySchema = z.strictObject({
  attempt: positiveIntegerSchema,
  durationMs: nonNegativeIntegerSchema.nullable(),
  endedAt: timestampSchema.nullable(),
  errorCode: z.string().trim().min(1).max(100).nullable(),
  startedAt: timestampSchema,
  status: stepAttemptStatusSchema,
  waitBeforeRetryMs: nonNegativeIntegerSchema.nullable(),
});

/**
 * Strict sanitized payloads per workflow step to guarantee zero leaks
 * of raw prompts, confidential diffs, secrets, or authorization headers.
 */
export const claimRunSanitizedInputSchema = z.strictObject({
  attempt: positiveIntegerSchema,
  baseSha: gitShaSchema,
  causalVersion: z.string().max(100),
  headSha: gitShaSchema,
  prKey: prKeySchema,
  runId: runIdSchema,
});

export const claimRunSanitizedOutputSchema = z.strictObject({
  outcome: z.string().max(50),
  supersededCount: nonNegativeIntegerSchema.optional(),
});

export const prepareRepositorySanitizedInputSchema = z.strictObject({
  baseSha: gitShaSchema,
  headSha: gitShaSchema,
  repoName: z.string().min(1).max(200),
  repoOwner: z.string().min(1).max(200),
});

export const prepareRepositorySanitizedOutputSchema = z.strictObject({
  changedLineCount: nonNegativeIntegerSchema,
  contextBytes: nonNegativeIntegerSchema,
  fileCount: nonNegativeIntegerSchema,
  structuralFilesCount: nonNegativeIntegerSchema.optional(),
  textualFilesCount: nonNegativeIntegerSchema.optional(),
  truncated: z.boolean(),
});

export const findingExcerptSchema = z.strictObject({
  line: positiveIntegerSchema,
  path: repositoryPathSchema,
  rule: z.string().max(100),
  severity: z.enum(["critical", "high", "medium", "low"]),
});

export const analyzeReviewSanitizedInputSchema = z.strictObject({
  estimatedTokens: nonNegativeIntegerSchema,
  modelRoute: z.string().max(100),
  structuralFilesCount: nonNegativeIntegerSchema,
  textualFilesCount: nonNegativeIntegerSchema,
  toolsBudget: nonNegativeIntegerSchema,
});

export const analyzeReviewSanitizedOutputSchema = z.strictObject({
  findingsCount: nonNegativeIntegerSchema,
  findingsExcerptList: z.array(findingExcerptSchema).max(50),
  promptTruncated: z.boolean(),
  summary: z.string().max(1000),
});

export const publishInlineSanitizedInputSchema = z.strictObject({
  line: positiveIntegerSchema,
  marker: z.string().max(100),
  path: repositoryPathSchema,
  side: z.enum(["LEFT", "RIGHT"]),
});

export const publishInlineSanitizedOutputSchema = z.strictObject({
  authorized: z.boolean(),
  githubCommentId: nonNegativeIntegerSchema.nullable(),
  published: z.boolean(),
});

export const publishSummarySanitizedInputSchema = z.strictObject({
  marker: z.string().max(100),
  verdict: z.string().max(50),
});

export const publishSummarySanitizedOutputSchema = z.strictObject({
  authorized: z.boolean(),
  githubCommentId: nonNegativeIntegerSchema.nullable(),
  published: z.boolean(),
});

export const completeRunSanitizedInputSchema = z.strictObject({
  nextState: z.string().max(50),
  runId: runIdSchema,
});

export const completeRunSanitizedOutputSchema = z.strictObject({
  cleanupTaskScheduled: z.boolean(),
  state: z.string().max(50),
});

const FORBIDDEN_KEY_PATTERNS = [
  /^auth(?:orization)?$/i,
  /auth[_-]?(?:header|token|secret|key)/i,
  /bearer/i,
  /(?:^|[a-z0-9_-]*(?:access|api|github|install(?:ation)?|jwt|session|auth))[_-]?token$/i,
  /^token$/i,
  /secret/i,
  /private[_-]?key/i,
  /password/i,
  /cookie/i,
  /(?:[a-z0-9_-]*[_-])?(?:diff|patch)$/i,
  /(?:[a-z0-9_-]*[_-])?prompt$/i,
];

export const MAX_SANITIZED_PAYLOAD_BYTES = 16_384; // 16 KB

/**
 * Validates and sanitizes an arbitrary payload object.
 * Enforces UTF-8 size under 16 KB and rejects objects containing forbidden keys.
 */
export function sanitizePayloadRecord(
  payload: unknown,
  maxBytes = MAX_SANITIZED_PAYLOAD_BYTES,
): Record<string, unknown> | null {
  if (
    payload === null ||
    payload === undefined ||
    typeof payload !== "object"
  ) {
    return null;
  }
  if (Array.isArray(payload)) {
    return null;
  }

  // Deep inspection for forbidden key names with cycle detection
  const seenObjects = new WeakSet<object>();
  function findForbiddenKey(obj: unknown): string | null {
    if (obj === null || typeof obj !== "object") return null;
    if (seenObjects.has(obj)) return null;
    seenObjects.add(obj);
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (FORBIDDEN_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
        return key;
      }
      if (typeof value === "object" && value !== null) {
        const nested = findForbiddenKey(value);
        if (nested) return nested;
      }
    }
    return null;
  }

  const forbiddenKey = findForbiddenKey(payload);
  if (forbiddenKey !== null) {
    throw new Error(
      `Payload contains forbidden sensitive property: ${forbiddenKey}`,
    );
  }

  // Safe JSON serialization handling circular references
  let json: string;
  try {
    const cycleTracker = new WeakSet<object>();
    json = JSON.stringify(payload, (_key, value) => {
      if (typeof value === "object" && value !== null) {
        if (cycleTracker.has(value)) {
          return "[Circular]";
        }
        cycleTracker.add(value);
      }
      return value;
    });
  } catch {
    return { error: "Unserializable payload" };
  }

  const bytes = new TextEncoder().encode(json).length;
  if (bytes > maxBytes) {
    throw new Error(
      `Sanitized payload exceeds ${maxBytes} bytes limit (got ${bytes} bytes)`,
    );
  }

  return JSON.parse(json) as Record<string, unknown>;
}

export const stepExecutionNodeSchema = z.strictObject({
  attempts: z.array(stepAttemptTelemetrySchema).max(50),
  attemptsCount: positiveIntegerSchema,
  errorCode: z.string().trim().min(1).max(100).nullable(),
  firstStartedAt: timestampSchema,
  lastEndedAt: timestampSchema.nullable(),
  phase: stepPhaseSchema,
  sanitizedInput: z.record(z.string(), z.any()).nullable(),
  sanitizedOutput: z.record(z.string(), z.any()).nullable(),
  status: stepExecutionStatusSchema,
  stepName: z.string().trim().min(1).max(100),
  stepOrder: nonNegativeIntegerSchema.optional(),
  totalDurationMs: nonNegativeIntegerSchema,
});

export type StepAttemptStatus = z.infer<typeof stepAttemptStatusSchema>;
export type StepExecutionStatus = z.infer<typeof stepExecutionStatusSchema>;
export type StepPhase = z.infer<typeof stepPhaseSchema>;
export type StepAttemptTelemetry = z.infer<typeof stepAttemptTelemetrySchema>;
export type StepExecutionNode = z.infer<typeof stepExecutionNodeSchema>;
