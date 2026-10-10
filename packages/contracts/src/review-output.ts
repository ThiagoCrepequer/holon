import { z } from "zod";

/** The severity contract supplied to both the final-answer schema and review instructions. */
export const reviewSeverityGuidance = [
  "Choose severity from demonstrated impact: critical requires security exploitation, serious data loss, or widespread, likely unavailability; high is an important functional regression or contract break with a concrete causal path; medium is a real defect of limited scope or a relevant conditional risk; low is an actionable small-impact improvement, normally summary-only.",
  "Use the least severe level justified by the inspected operation and reachable impact. Confidence does not increase severity. A runtime exception alone does not demonstrate widespread unavailability.",
].join("\n");

import { investigationObservationSchema } from "./repository-memory.js";
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

export { reviewFindingSchema } from "./review-finding.js";
import { reviewFindingSchema } from "./review-finding.js";

export const reviewResolutionSchema = z.strictObject({
  ...z
    .object(reviewFindingSchema.shape)
    .omit({ severity: true, suggestion: true }).shape,
  fingerprint: z.string().regex(/^fp:[a-f0-9]{64}$/u),
});
export const modelReviewOutputSchema = z
  .strictObject({
    investigations: z.array(investigationObservationSchema).max(4).optional(),
    resolutions: z.array(reviewResolutionSchema).max(8).optional(),
    findings: z.array(reviewFindingSchema).max(reviewTextLimits.findings),
    isDegraded: z.boolean().optional(),
    summary: z.string().trim().max(reviewTextLimits.summary),
    outputLimitations: reviewOutputLimitationsSchema.optional(),
  })
  .refine((output) => output.summary.length > 0 || output.isDegraded === true, {
    message: "blank summary requires degraded output",
    path: ["summary"],
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
  z.optional(z.nullable(positiveIntegerSchema)),
);

const resilientConfidence = z.preprocess(
  (val) =>
    typeof val === "string" && /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/u.test(val.trim())
      ? Number(val.trim())
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
const resilientSummary = boundedText(reviewTextLimits.summary, 0);

const resilientSeverity = z.preprocess(
  (val) => (typeof val === "string" ? val.toLowerCase().trim() : val),
  z.enum(["critical", "high", "medium", "low"]),
);

const resilientEvidence = z.preprocess(
  (val) => (Array.isArray(val) ? val.slice(0, reviewTextLimits.evidence) : []),
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
);
const resilientLocation = z
  .object({
    line: resilientPositiveInteger,
    path: repositoryPathSchema,
    side: z.literal("RIGHT"),
    startLine: resilientNullablePositiveInteger,
  })
  .strip();

/**
 * JSON-Schema-portable model boundary. Optional domain fields are required but
 * nullable so strict providers see a stable set of required properties. Coercive
 * preprocessors ensure minor LLM output imperfections (length, extra fields, string numbers)
 * are gracefully sanitized rather than failing the review.
 */
const reviewTransportFields = z
  .object({
    investigations: z.array(investigationObservationSchema).max(4).optional(),
    resolutions: z
      .array(
        z
          .object({
            confidence: resilientConfidence,
            diagnostic: resilientDiagnostic,
            evidence: resilientEvidence,
            fingerprint: z.string().regex(/^fp:[a-f0-9]{64}$/u),
            location: resilientLocation,
          })
          .strip(),
      )
      .max(8)
      .optional(),
    findings: z.preprocess(
      (val) =>
        Array.isArray(val) ? val.slice(0, reviewTextLimits.findings) : val,
      z
        .array(
          z
            .object({
              confidence: resilientConfidence,
              diagnostic: resilientDiagnostic,
              evidence: resilientEvidence,
              location: resilientLocation,
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

/** JSON Schema surface for Think's forced final-answer tool. Evidence remains
 * structurally permissive here so the host can reject unevidenced candidates
 * individually instead of aborting Think's entire prompt workflow. */
export const modelReviewPromptSchema = z.object({
  findings: z
    .array(
      z.object({
        confidence: z.number(),
        diagnostic: z
          .string()
          .describe(
            "Name the concrete failing consumer or operation and explain how the changed code causes that failure.",
          ),
        evidence: z
          .array(
            z.object({
              endLine: z.number().int().nullable(),
              excerpt: z.string(),
              path: z.string(),
              reason: z.string(),
              startLine: z.number().int(),
            }),
          )
          .describe(
            "Copy at least one excerpt verbatim from the supplied canonical patch at its exact RIGHT-side coordinates. Repository tool reads demonstrate impact but are not publishable patch evidence. Candidates without valid evidence are rejected and make the review partial.",
          ),
        location: z.object({
          line: z
            .number()
            .int()
            .describe(
              "A supplied RIGHT-side changed line in the canonical patch.",
            ),
          path: z
            .string()
            .describe(
              "The changed producer file from the supplied patch, including when its defect manifests in an unchanged consumer.",
            ),
          side: z
            .literal("RIGHT")
            .describe(
              'Use exactly "RIGHT" in uppercase; it identifies the changed HEAD line, never a consumer or base line.',
            ),
          startLine: z.number().int().nullable(),
        }),
        severity: z
          .enum(["critical", "high", "medium", "low"])
          .describe(reviewSeverityGuidance),
        suggestion: z
          .string()
          .nullable()
          .describe(
            "A plain text repair suggestion, or null when absent. Never return an object, array or code-edit structure.",
          ),
      }),
    )
    .describe(
      "Record confirmed defects here, even when also described in investigations or the summary. Use an empty array only when no concrete defect was demonstrated.",
    ),
  investigations: z
    .array(investigationObservationSchema)
    .max(4)
    .describe(
      "Required array of factual observations for revalidation; return [] when there are none. An observation never replaces a finding for a confirmed defect.",
    ),
  isDegraded: z.boolean(),
  outputLimitations: z.array(z.enum(reviewOutputLimitationCodes)),
  resolutions: z.array(
    z.object({
      confidence: z.number(),
      diagnostic: z.string(),
      evidence: z
        .array(
          z.object({
            endLine: z.number().int().nullable(),
            excerpt: z.string(),
            path: z.string(),
            reason: z.string(),
            startLine: z.number().int(),
          }),
        )
        .describe(
          "Provide at least one source excerpt proving this resolution. Resolutions without valid evidence are rejected and make the review partial.",
        ),
      fingerprint: z.string(),
      location: z.object({
        line: z.number().int(),
        path: z.string(),
        side: z.literal("RIGHT"),
        startLine: z.number().int().nullable(),
      }),
    }),
  ),
  summary: z
    .string()
    .describe(
      "Return a non-empty, concise summary of the analyzed scope and any remaining limitations, including when no defects were verified.",
    ),
});

/** Narrative recovery cannot add, replace or remove review candidates. */
export const reviewSummaryRecoverySchema = z.strictObject({
  summary: z.string().trim().min(1).max(reviewTextLimits.summary),
  isDegraded: z.boolean(),
  outputLimitations: reviewOutputLimitationsSchema,
});

export const modelReviewTransportSchema = z.preprocess((value) => {
  if (typeof value !== "object" || value === null) return value;
  const raw = value as Record<string, unknown>;
  // Invalid envelopes still fail. Recovery applies only to candidate evidence.
  const envelope = reviewTransportFields
    .omit({ findings: true, resolutions: true })
    .safeParse(raw);
  if (!envelope.success) return raw;
  const limitations = new Set([
    ...(envelope.data.outputLimitations ?? []),
    ...reviewOutputLimitations(raw),
  ]);
  let rejected = false;
  const retainEvidenced = (candidate: unknown) => {
    if (typeof candidate !== "object" || candidate === null) return true;
    const evidence = resilientEvidence.safeParse(
      (candidate as Record<string, unknown>).evidence,
    );
    const valid =
      evidence.success &&
      reviewFindingSchema.shape.evidence.safeParse(
        evidence.data.map((item) => ({
          ...item,
          ...(item.endLine === null ? { endLine: undefined } : {}),
        })),
      ).success;
    if (!valid) rejected = true;
    return valid;
  };
  const findings = Array.isArray(raw.findings)
    ? raw.findings.slice(0, reviewTextLimits.findings).filter(retainEvidenced)
    : raw.findings;
  // Preserve the existing hard limit on the resolution envelope.
  const resolutions =
    Array.isArray(raw.resolutions) && raw.resolutions.length <= 8
      ? raw.resolutions.filter(retainEvidenced)
      : raw.resolutions;
  if (rejected) limitations.add("evidence_rejected");
  return {
    ...raw,
    findings,
    resolutions,
    ...(rejected
      ? {
          isDegraded: true,
          summary:
            "Review incomplete: candidates without valid evidence were rejected. Retained candidates still require verification.",
        }
      : {}),
    outputLimitations: [...limitations],
  };
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
  const limitations = new Set(transport.outputLimitations ?? []);
  if (transport.summary.length === 0) limitations.add("summary_missing");
  return modelReviewOutputSchema.parse({
    ...(transport.investigations
      ? { investigations: transport.investigations }
      : {}),
    ...(transport.resolutions !== undefined
      ? {
          resolutions: transport.resolutions.map((resolution) => ({
            ...resolution,
            evidence: resolution.evidence.map((evidence) => ({
              ...evidence,
              ...(evidence.endLine === null ? { endLine: undefined } : {}),
            })),
            location: {
              ...resolution.location,
              ...(resolution.location.startLine === null
                ? { startLine: undefined }
                : {}),
            },
          })),
        }
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
    ...(limitations.size ? { isDegraded: true } : {}),
    ...(limitations.size ? { outputLimitations: [...limitations] } : {}),
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
    githubCommentId: z.optional(positiveIntegerSchema),
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
