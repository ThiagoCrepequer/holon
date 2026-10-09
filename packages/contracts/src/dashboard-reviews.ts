import { runStates } from "@holon/domain";
import { z } from "zod";

import { findingStatusSchema } from "./finding-lifecycle.js";
import { reviewFindingSchema } from "./review-output.js";
import { runIdSchema } from "./shared.js";

z.config({ jitless: true });
const id = z.number().int().positive().safe();
const sha = z.string().regex(/^[a-f0-9]{40}$/);
export const reviewCoordinatesSchema = z.strictObject({
  installationId: id,
  repositoryId: id,
  pullRequestNumber: id,
});
export const pullRequestMetadataSchema = reviewCoordinatesSchema.extend({
  title: z.string().max(1024),
  author: z.string().min(1).max(100),
  pullRequestState: z.enum(["open", "closed", "merged"]),
  headSha: sha,
  baseSha: sha,
  sourceUpdatedAt: z.iso.datetime(),
});
export const privateReviewSummarySchema = reviewCoordinatesSchema.extend({
  title: z.string().max(1024),
  author: z.string().min(1).max(100),
  pullRequestState: z.enum(["open", "closed", "merged"]),
  headSha: sha,
  baseSha: sha,
  runId: runIdSchema.nullable(),
  state: z.enum(["awaiting_review", "metadata_conflict", ...runStates]),
  snapshotRevision: id,
  activityAt: z.iso.datetime(),
  observedAt: z.iso.datetime(),
});
export const projectionWriteSchema = z.strictObject({
  generation: id,
  snapshot: privateReviewSummarySchema,
});
export const projectionWriteResultSchema = z.enum([
  "applied",
  "duplicate",
  "stale",
  "conflict",
  "fenced",
]);
export const reviewListInputSchema = z.strictObject({
  workspaceId: z.string().min(1).max(200),
  installationId: id,
  repositoryId: id,
  status: privateReviewSummarySchema.shape.state.nullable().default(null),
  search: z.string().max(200).default(""),
  cursor: z.string().min(1).max(1024).nullable().default(null),
  limit: z.number().int().min(1).max(50).default(50),
});
export const privateReviewPageSchema = z.strictObject({
  items: z.array(privateReviewSummarySchema).max(50),
  nextCursor: z.string().max(1024).nullable(),
  total: z.number().int().nonnegative().safe(),
  observedAt: z.iso.datetime(),
});
export const reviewDetailInputSchema = reviewCoordinatesSchema.extend({
  workspaceId: z.string().min(1).max(200),
  cursor: z.string().min(1).max(512).nullable().default(null),
});
export const coreReviewDetailInputSchema = reviewCoordinatesSchema.extend({
  cursor: reviewDetailInputSchema.shape.cursor,
});
export const privateReviewDetailSchema = z.strictObject({
  review: privateReviewSummarySchema,
  summary: z.string().max(16000).nullable(),
  findings: z
    .array(
      reviewFindingSchema.extend({
        fingerprint: z.string().max(200),
        status: findingStatusSchema,
      }),
    )
    .max(10),
  totalFindings: z.number().int().nonnegative().max(10000),
  nextCursor: z.string().max(512).nullable(),
});
export const recoveryScopeSchema = z.strictObject({
  installationId: id,
  repositoryId: id,
  expectedGeneration: id,
});
export const resumeProjectionSchema = recoveryScopeSchema
  .extend({ generation: id })
  .refine((x) => x.generation > x.expectedGeneration);
/** Accent-insensitive contains; NFD and Unicode mark removal are applied on both sides. */
export function normalizeReviewSearch(value: string): string {
  return value.normalize("NFD").toLowerCase().replace(/\p{M}/gu, "");
}
export type ReviewCoordinates = z.infer<typeof reviewCoordinatesSchema>;
export type PullRequestMetadata = z.infer<typeof pullRequestMetadataSchema>;
export type PrivateReviewSummary = z.infer<typeof privateReviewSummarySchema>;
export type ProjectionWrite = z.infer<typeof projectionWriteSchema>;
export type ProjectionWriteResult = z.infer<typeof projectionWriteResultSchema>;
export type ReviewListInput = z.infer<typeof reviewListInputSchema>;
export type PrivateReviewPage = z.infer<typeof privateReviewPageSchema>;
export type ReviewDetailInput = z.infer<typeof reviewDetailInputSchema>;
export type PrivateReviewDetail = z.infer<typeof privateReviewDetailSchema>;
export interface ReviewProjectionWriterPort {
  write(input: ProjectionWrite): Promise<ProjectionWriteResult>;
}
export interface PrivateReviewCorePort {
  detail(
    input: z.infer<typeof coreReviewDetailInputSchema>,
  ): Promise<CoreReviewDetailResult>;
}

export const reviewCursorPositionSchema = z.strictObject({
  activityAt: z.iso.datetime(),
  pullRequestNumber: z.number().int().positive().safe(),
});

export const reviewReadIdentitySchema = z.strictObject({
  userId: z.string().min(1).max(200),
  sessionId: z.string().min(1).max(200),
});
export const reviewListResponseSchema = z.strictObject({
  identity: reviewReadIdentitySchema,
  result: privateReviewPageSchema,
});
export const reviewDetailResponseSchema = z.strictObject({
  identity: reviewReadIdentitySchema,
  result: privateReviewDetailSchema,
});

export const coreReviewDetailResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("available"),
    generation: id,
    detail: privateReviewDetailSchema,
  }),
  z.strictObject({
    status: z.enum(["unavailable", "revision_changed", "invalid_request"]),
  }),
]);
export type CoreReviewDetailResult = z.infer<
  typeof coreReviewDetailResultSchema
>;
