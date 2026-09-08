import { z } from "zod";

import {
  reviewTextLimits,
  limitReviewText,
  reviewOutputLimitations,
  reviewOutputLimitationCodes,
} from "./review-limits.js";
export const reviewOutputLimitationsSchema = z
  .array(z.enum(reviewOutputLimitationCodes))
  .max(20);

import {
  findingIdSchema,
  positiveIntegerSchema,
  prKeySchema,
  publicationIdSchema,
  repositoryPathSchema,
  runIdSchema,
  timestampSchema,
} from "./shared.js";

export const reviewFindingSchema = z.strictObject({
  confidence: z.number().min(0).max(1),
  diagnostic: z.string().trim().min(30).max(reviewTextLimits.diagnostic),
  evidence: z
    .array(
      z
        .strictObject({
          endLine: positiveIntegerSchema.optional(),
          excerpt: z.string().min(1).max(reviewTextLimits.excerpt),
          path: repositoryPathSchema,
          reason: z.string().min(1).max(reviewTextLimits.reason),
          startLine: positiveIntegerSchema,
        })
        .refine(
          (evidence) =>
            evidence.endLine === undefined ||
            evidence.endLine >= evidence.startLine,
          {
            message: "endLine must not precede startLine",
            path: ["endLine"],
          },
        ),
    )
    .min(1)
    .max(reviewTextLimits.evidence),
  location: z
    .strictObject({
      line: positiveIntegerSchema,
      path: repositoryPathSchema,
      side: z.literal("RIGHT"),
      startLine: positiveIntegerSchema.optional(),
    })
    .refine(
      (location) =>
        location.startLine === undefined || location.startLine <= location.line,
      {
        message: "startLine must not follow line",
        path: ["startLine"],
      },
    ),
  severity: z.enum(["critical", "high", "medium", "low"]),
  suggestion: z
    .string()
    .trim()
    .min(1)
    .max(reviewTextLimits.suggestion)
    .optional(),
});

export const reviewResolutionSchema = reviewFindingSchema
  .omit({ severity: true, suggestion: true })
  .extend({
    fingerprint: z.string().regex(/^fp:[a-f0-9]{64}$/u),
  });
export const modelReviewOutputSchema = z.strictObject({
  resolutions: z.array(reviewResolutionSchema).max(8).optional(),
  findings: z.array(reviewFindingSchema).max(reviewTextLimits.findings),
  isDegraded: z.boolean().optional(),
  summary: z.string().trim().min(1).max(reviewTextLimits.summary),
  outputLimitations: reviewOutputLimitationsSchema.optional(),
});

/**
 * JSON-Schema-portable model boundary. Optional domain fields are required but
 * nullable so strict providers see a stable set of required properties. Cross-
 * field invariants remain in modelReviewOutputSchema and are checked after the
 * transport value is normalized.
 */
const resilientPositiveInteger = z.preprocess(
  (val) =>
    typeof val === "string" && /^\d+$/u.test(val.trim())
      ? Number(val.trim())
      : val,
  positiveIntegerSchema,
);

const resilientNullablePositiveInteger = z.preprocess(
  (val) =>
    typeof val === "string" && /^\d+$/u.test(val.trim())
      ? Number(val.trim())
      : val,
  positiveIntegerSchema.nullable(),
);

const resilientConfidence = z.preprocess(
  (val) =>
    typeof val === "string" && !Number.isNaN(Number.parseFloat(val))
      ? Math.max(0, Math.min(1, Number.parseFloat(val)))
      : val,
  z.number().min(0).max(1),
);

const boundedText = (maximum: number, minimum = 1, marker = "…") =>
  z.preprocess(
    (value) =>
      typeof value === "string"
        ? limitReviewText(value.trim(), maximum, marker)
        : value,
    z.string().min(minimum).max(maximum),
  );
const resilientDiagnostic = boundedText(reviewTextLimits.diagnostic, 30);
const resilientExcerpt = z.preprocess(
  (value) =>
    typeof value === "string"
      ? limitReviewText(value, reviewTextLimits.excerpt, "")
      : value,
  z.string().min(1).max(reviewTextLimits.excerpt),
);
const resilientReason = boundedText(reviewTextLimits.reason);
const resilientSuggestion = z.preprocess(
  (value) =>
    typeof value === "string"
      ? value.trim()
        ? limitReviewText(value.trim(), reviewTextLimits.suggestion)
        : null
      : value,
  z.string().min(1).max(reviewTextLimits.suggestion).nullable(),
);
const resilientSummary = boundedText(reviewTextLimits.summary);

const resilientSeverity = z.preprocess(
  (val) => (typeof val === "string" ? val.toLowerCase().trim() : val),
  z.enum(["critical", "high", "medium", "low"]),
);

/**
 * JSON-Schema-portable model boundary. Optional domain fields are required but
 * nullable so strict providers see a stable set of required properties. Coercive
 * preprocessors ensure minor LLM output imperfections (length, extra fields, string numbers)
 * are gracefully sanitized rather than failing the review.
 */
const reviewTransportFields = z
  .object({
    resolutions: z.array(reviewResolutionSchema).max(8).optional(),
    findings: z.preprocess(
      (val) =>
        Array.isArray(val) ? val.slice(0, reviewTextLimits.findings) : [],
      z
        .array(
          z
            .object({
              confidence: resilientConfidence,
              diagnostic: resilientDiagnostic,
              evidence: z.preprocess(
                (val) =>
                  Array.isArray(val)
                    ? val.slice(0, reviewTextLimits.evidence)
                    : [],
                z
                  .array(
                    z
                      .object({
                        endLine: resilientNullablePositiveInteger,
                        excerpt: resilientExcerpt,
                        path: repositoryPathSchema,
                        reason: resilientReason,
                        startLine: resilientPositiveInteger,
                      })
                      .strip(),
                  )
                  .min(1)
                  .max(reviewTextLimits.evidence),
              ),
              location: z
                .object({
                  line: resilientPositiveInteger,
                  path: repositoryPathSchema,
                  side: z.literal("RIGHT"),
                  startLine: resilientNullablePositiveInteger,
                })
                .strip(),
              severity: resilientSeverity,
              suggestion: resilientSuggestion,
            })
            .strip(),
        )
        .max(reviewTextLimits.findings),
    ),
    isDegraded: z.boolean().optional(),
    summary: resilientSummary,
    outputLimitations: reviewOutputLimitationsSchema.optional(),
  })
  .strip();

export const modelReviewTransportSchema = z.preprocess((value) => {
  if (typeof value !== "object" || value === null) return value;
  return { ...value, outputLimitations: reviewOutputLimitations(value) };
}, reviewTransportFields);

export function parseModelReviewTransport(value: unknown): ModelReviewOutput {
  return modelReviewOutputFromTransport(
    modelReviewTransportSchema.parse(value),
  );
}

export function modelReviewOutputFromTransport(
  raw: z.output<typeof modelReviewTransportSchema>,
): ModelReviewOutput {
  const transport = reviewTransportFields.parse(raw);
  return modelReviewOutputSchema.parse({
    ...(transport.resolutions !== undefined
      ? { resolutions: transport.resolutions }
      : {}),
    findings: transport.findings.map((finding) => ({
      ...finding,
      evidence: finding.evidence.map((evidence) => ({
        ...evidence,
        ...(evidence.endLine === null ? { endLine: undefined } : {}),
      })),
      location: {
        ...finding.location,
        ...(finding.location.startLine === null
          ? { startLine: undefined }
          : {}),
      },
      ...(finding.suggestion === null ? { suggestion: undefined } : {}),
    })),
    ...(transport.isDegraded !== undefined
      ? { isDegraded: transport.isDegraded }
      : {}),
    summary: transport.summary,
    ...(transport.outputLimitations?.length ? { isDegraded: true } : {}),
    ...(transport.outputLimitations?.length
      ? { outputLimitations: transport.outputLimitations }
      : {}),
  });
}

export const runStateSchema = z.enum([
  "queued",
  "running",
  "publishing",
  "completed",
  "obsolete",
  "failed_retryable",
  "failed_terminal",
]);

export const reviewRunSchema = z
  .strictObject({
    attempt: z.number().int().nonnegative().safe(),
    causalVersion: timestampSchema,
    createdAt: timestampSchema,
    id: runIdSchema,
    prKey: prKeySchema,
    state: runStateSchema,
    updatedAt: timestampSchema.optional(),
  })
  .refine((run) => run.id.startsWith(`${run.prKey}:head:`), {
    message: "run id does not belong to prKey",
    path: ["id"],
  });

export const workflowInstanceIdSchema = z.string().trim().min(1).max(512);

export const runClaimSchema = z.strictObject({
  run: reviewRunSchema,
  workflowInstanceId: workflowInstanceIdSchema,
});

export const supersededWorkflowSchema = z.strictObject({
  runId: runIdSchema,
  workflowInstanceId: workflowInstanceIdSchema,
});

export const runClaimResultSchema = z.strictObject({
  outcome: z.enum(["claimed", "duplicate", "resume"]),
  supersededWorkflows: z.array(supersededWorkflowSchema).max(100),
});

export const runTransitionSchema = z.strictObject({
  expected: runStateSchema,
  next: runStateSchema,
  occurredAt: timestampSchema,
  operationId: z.string().trim().min(1).max(1_024),
  runId: runIdSchema,
});

export const publicationRecordSchema = z
  .strictObject({
    findingId: z.union([findingIdSchema, z.literal("summary")]),
    githubCommentId: positiveIntegerSchema.optional(),
    kind: z.enum(["inline", "summary"]),
    marker: z.string().regex(/^<!-- holon;run=[^;]+;finding=[^ ]+ -->$/u),
    id: publicationIdSchema,
    runId: runIdSchema,
    state: z.enum(["publishing", "published"]),
  })
  .superRefine((publication, context) => {
    const expectedId = `${publication.runId}:publication:${publication.findingId}`;
    if (publication.id !== expectedId) {
      context.addIssue({
        code: "custom",
        message: "publicationId does not match its components",
        path: ["id"],
      });
    }
    if (publication.kind === "summary" && publication.findingId !== "summary") {
      context.addIssue({
        code: "custom",
        message: "summary publication requires summary findingId",
        path: ["findingId"],
      });
    }
    if (
      publication.state === "published" &&
      publication.githubCommentId === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "published record requires githubCommentId",
        path: ["githubCommentId"],
      });
    }
  });

export type ReviewFinding = z.infer<typeof reviewFindingSchema>;
export type ModelReviewOutput = z.infer<typeof modelReviewOutputSchema>;
export type PublicationRecord = z.infer<typeof publicationRecordSchema>;
export type ReviewRun = z.infer<typeof reviewRunSchema>;
export type RunClaimResult = z.infer<typeof runClaimResultSchema>;
export type SupersededWorkflow = z.infer<typeof supersededWorkflowSchema>;
export type RunTransition = z.infer<typeof runTransitionSchema>;
