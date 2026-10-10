import { runStates } from "@holon/domain";
import { z, _default as withDefault } from "zod/mini";

// Configure CSP-safe Zod before the dependent core schemas construct objects.
import { dashboardIdSchema } from "./dashboard.js";
import { findingStatusSchema } from "./finding-status.js";
import { reviewFindingSchema } from "./review-finding.js";
import { runIdSchema } from "./review-primitives.js";

const id = z.number().check(z.int()).check(z.positive());
const sha = z.string().check(z.regex(/^[a-f0-9]{40}$/));
export const reviewCoordinatesSchema = z.strictObject({
  installationId: id,
  repositoryId: id,
  pullRequestNumber: id,
});
export const pullRequestMetadataSchema = z.extend(reviewCoordinatesSchema, {
  title: z.string().check(z.maxLength(1024)),
  author: z.string().check(z.minLength(1)).check(z.maxLength(100)),
  pullRequestState: z.enum(["open", "closed", "merged"]),
  headSha: sha,
  baseSha: sha,
  sourceUpdatedAt: z.iso.datetime(),
});
export const privateReviewSummarySchema = z.extend(reviewCoordinatesSchema, {
  title: z.string().check(z.maxLength(1024)),
  author: z.string().check(z.minLength(1)).check(z.maxLength(100)),
  pullRequestState: z.enum(["open", "closed", "merged"]),
  headSha: sha,
  baseSha: sha,
  runId: z.nullable(runIdSchema),
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
  workspaceId: dashboardIdSchema,
  installationId: id,
  repositoryId: id,
  status: withDefault(z.nullable(privateReviewSummarySchema.shape.state), null),
  search: withDefault(z.string().check(z.maxLength(200)), ""),
  cursor: withDefault(
    z.nullable(z.string().check(z.minLength(1)).check(z.maxLength(1024))),
    null,
  ),
  limit: withDefault(
    z.number().check(z.int()).check(z.gte(1)).check(z.lte(50)),
    50,
  ),
});
export const privateReviewPageSchema = z.strictObject({
  items: z.array(privateReviewSummarySchema).check(z.maxLength(50)),
  nextCursor: z.nullable(z.string().check(z.maxLength(1024))),
  total: z.number().check(z.int()).check(z.nonnegative()),
  observedAt: z.iso.datetime(),
});
export const reviewDetailInputSchema = z.extend(reviewCoordinatesSchema, {
  workspaceId: dashboardIdSchema,
  cursor: withDefault(
    z.nullable(z.string().check(z.minLength(1)).check(z.maxLength(512))),
    null,
  ),
});
export const coreReviewDetailInputSchema = z.extend(reviewCoordinatesSchema, {
  cursor: reviewDetailInputSchema.shape.cursor,
});
export const privateReviewDetailSchema = z.strictObject({
  review: privateReviewSummarySchema,
  summary: z.nullable(z.string().check(z.maxLength(16000))),
  findings: z
    .array(
      z.extend(reviewFindingSchema, {
        fingerprint: z.string().check(z.maxLength(200)),
        status: findingStatusSchema,
      }),
    )
    .check(z.maxLength(10)),
  totalFindings: z
    .number()
    .check(z.int())
    .check(z.nonnegative())
    .check(z.lte(10000)),
  nextCursor: z.nullable(z.string().check(z.maxLength(512))),
});
export const recoveryScopeSchema = z.strictObject({
  installationId: id,
  repositoryId: id,
  expectedGeneration: id,
});
export const resumeProjectionSchema = z
  .extend(recoveryScopeSchema, { generation: id })
  .check(z.refine((x) => x.generation > x.expectedGeneration));
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
  pullRequestNumber: z
    .number()
    .check(z.int())
    .check(z.positive())
    .check(z.int()),
});

export const reviewReadIdentitySchema = z.strictObject({
  userId: z.string().check(z.minLength(1)).check(z.maxLength(200)),
  sessionId: z.string().check(z.minLength(1)).check(z.maxLength(200)),
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
