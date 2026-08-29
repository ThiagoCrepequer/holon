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
  diagnostic: z.string().trim().min(30).max(2_000),
  evidence: z
    .array(
      z
        .strictObject({
          endLine: positiveIntegerSchema.optional(),
          excerpt: z.string().min(1).max(2_000),
          path: repositoryPathSchema,
          reason: z.string().min(1).max(500),
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
    .max(5),
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
  suggestion: z.string().trim().min(1).max(4_000).optional(),
});

export const modelReviewOutputSchema = z.strictObject({
  findings: z.array(reviewFindingSchema).max(20),
  summary: z.string().trim().min(1).max(4_000),
});

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

export const runClaimSchema = z.strictObject({
  run: reviewRunSchema,
  workflowInstanceId: z.string().trim().min(1).max(512),
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
export type RunTransition = z.infer<typeof runTransitionSchema>;
