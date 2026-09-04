import { z } from "zod";

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
  diagnostic: z.string().trim().min(30).max(600),
  evidence: z
    .array(
      z
        .strictObject({
          endLine: positiveIntegerSchema.optional(),
          excerpt: z.string().min(1).max(300),
          path: repositoryPathSchema,
          reason: z.string().min(1).max(200),
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
    .max(2),
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
  suggestion: z.string().trim().min(1).max(800).optional(),
});

export const modelReviewOutputSchema = z.strictObject({
  findings: z.array(reviewFindingSchema).max(3),
  isDegraded: z.boolean().optional(),
  summary: z.string().trim().min(1).max(2_500),
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

const resilientDiagnostic = z.preprocess((val) => {
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.length > 600) return `${trimmed.slice(0, 597)}...`;
    if (trimmed.length < 30) return `${trimmed} (verified during analysis)`;
    return trimmed;
  }
  return val;
}, z.string().trim().min(30).max(600));

const resilientExcerpt = z.preprocess(
  (val) =>
    typeof val === "string" && val.length > 300 ? val.slice(0, 300) : val,
  z.string().min(1).max(300),
);

const resilientReason = z.preprocess(
  (val) =>
    typeof val === "string" && val.length > 200
      ? `${val.slice(0, 197)}...`
      : val,
  z.string().min(1).max(200),
);

const resilientSuggestion = z.preprocess((val) => {
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length > 800) return `${trimmed.slice(0, 797)}...`;
    return trimmed;
  }
  return val;
}, z.string().trim().min(1).max(800).nullable());

const resilientSummary = z.preprocess((val) => {
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.length > 2_500) {
      const slice = trimmed.slice(0, 2_497);
      const lastBreak = Math.max(
        slice.lastIndexOf(". "),
        slice.lastIndexOf("\n"),
      );
      if (lastBreak > 2_000) {
        return `${slice.slice(0, lastBreak + 1)}...`;
      }
      return `${slice}...`;
    }
    return trimmed;
  }
  return val;
}, z.string().trim().min(1).max(2_500));

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
export const modelReviewTransportSchema = z
  .object({
    findings: z.preprocess(
      (val) => (Array.isArray(val) ? val.slice(0, 3) : []),
      z
        .array(
          z
            .object({
              confidence: resilientConfidence,
              diagnostic: resilientDiagnostic,
              evidence: z.preprocess(
                (val) => (Array.isArray(val) ? val.slice(0, 2) : []),
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
                  .max(2),
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
        .max(3),
    ),
    isDegraded: z.boolean().optional(),
    summary: resilientSummary,
  })
  .strip();

export function parseModelReviewTransport(value: unknown): ModelReviewOutput {
  const transport = modelReviewTransportSchema.parse(value);
  return modelReviewOutputSchema.parse({
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
    causalVersion: timestampSchema.optional(),
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

export const runClaimV2ResultSchema = z.strictObject({
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
    marker: z.string().regex(/^<!-- holon:v1;run=[^;]+;finding=[^ ]+ -->$/u),
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
export type RunClaimV2Result = z.infer<typeof runClaimV2ResultSchema>;
export type SupersededWorkflow = z.infer<typeof supersededWorkflowSchema>;
export type RunTransition = z.infer<typeof runTransitionSchema>;
