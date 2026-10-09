import { expect, it } from "vitest";

import {
  normalizeReviewSearch,
  pullRequestMetadataSchema,
  privateReviewSummarySchema,
  privateReviewDetailSchema,
  privateReviewPageSchema,
  reviewListInputSchema,
  reviewDetailInputSchema,
  projectionWriteSchema,
  projectionWriteResultSchema,
  coreReviewDetailResultSchema,
  resumeProjectionSchema,
  reviewListResponseSchema,
  reviewDetailResponseSchema,
  reviewCursorPositionSchema,
} from "../src/dashboard-reviews.js";
const review = {
  installationId: 1,
  repositoryId: 2,
  pullRequestNumber: 3,
  title: "</script><svg onload=hostile()>",
  author: "synthetic",
  pullRequestState: "open",
  headSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  runId: null,
  state: "awaiting_review",
  snapshotRevision: 1,
  activityAt: "2026-10-09T00:00:00.000Z",
  observedAt: "2026-10-09T00:00:00.000Z",
};
it("validates one strict projection/detail/page protocol, keeping hostile strings as data", () => {
  const metadata = {
    installationId: 1,
    repositoryId: 2,
    pullRequestNumber: 3,
    title: review.title,
    author: review.author,
    pullRequestState: review.pullRequestState,
    headSha: review.headSha,
    baseSha: review.baseSha,
    sourceUpdatedAt: review.activityAt,
  };
  expect(pullRequestMetadataSchema.parse(metadata)).toEqual(metadata);
  expect(privateReviewSummarySchema.parse(review)).toEqual(review);
  const detail = {
      review,
      summary: null,
      findings: [],
      totalFindings: 0,
      nextCursor: null,
    },
    page = {
      items: [review],
      total: 1,
      nextCursor: null,
      observedAt: review.observedAt,
    },
    identity = { userId: "actor", sessionId: "session" };
  expect(privateReviewDetailSchema.parse(detail)).toEqual(detail);
  expect(privateReviewPageSchema.parse(page)).toEqual(page);
  expect(
    projectionWriteSchema.parse({ generation: 1, snapshot: review }),
  ).toEqual({ generation: 1, snapshot: review });
  expect(reviewListResponseSchema.parse({ identity, result: page })).toEqual({
    identity,
    result: page,
  });
  expect(
    reviewDetailResponseSchema.parse({ identity, result: detail }),
  ).toEqual({ identity, result: detail });
  expect(
    coreReviewDetailResultSchema.parse({
      status: "available",
      generation: 1,
      detail,
    }),
  ).toMatchObject({ status: "available" });
  for (const status of ["unavailable", "revision_changed", "invalid_request"])
    expect(coreReviewDetailResultSchema.parse({ status })).toEqual({ status });
  for (const result of ["applied", "duplicate", "stale", "conflict", "fenced"])
    expect(projectionWriteResultSchema.parse(result)).toBe(result);
  expect(
    reviewCursorPositionSchema.parse({
      activityAt: review.activityAt,
      pullRequestNumber: 3,
    }),
  ).toMatchObject({ pullRequestNumber: 3 });
  for (const invalid of [
    { ...review, token: "private" },
    { ...review, runId: "../private" },
    { ...review, snapshotRevision: 0 },
    { ...review, title: "x".repeat(1025) },
  ])
    expect(privateReviewSummarySchema.safeParse(invalid).success).toBe(false);
});
it("bounds input, page and findings independently of transport and denies recovery relabeling", () => {
  const input = { workspaceId: "team", installationId: 1, repositoryId: 2 };
  expect(reviewListInputSchema.parse(input)).toMatchObject({
    limit: 50,
    status: null,
    search: "",
    cursor: null,
  });
  expect(
    reviewDetailInputSchema.parse({ ...input, pullRequestNumber: 3 }),
  ).toMatchObject({ cursor: null });
  for (const invalid of [
    { ...input, limit: 51 },
    { ...input, repositoryId: 0 },
    { ...input, search: "x".repeat(201) },
    { ...input, cursor: "x".repeat(1025) },
  ])
    expect(reviewListInputSchema.safeParse(invalid).success).toBe(false);
  expect(
    privateReviewPageSchema.safeParse({
      items: Array.from({ length: 51 }, () => ({ ...review })),
      total: 51,
      nextCursor: null,
      observedAt: review.observedAt,
    }).success,
  ).toBe(false);
  expect(
    resumeProjectionSchema.safeParse({
      installationId: 1,
      repositoryId: 2,
      expectedGeneration: 1,
      generation: 1,
    }).success,
  ).toBe(false);
  expect(
    resumeProjectionSchema.parse({
      installationId: 1,
      repositoryId: 2,
      expectedGeneration: 1,
      generation: 2,
    }).generation,
  ).toBe(2);
  expect(normalizeReviewSearch("CORREÇÃO ÁGIL %_ 😀")).toBe(
    "correcao agil %_ 😀",
  );
});
