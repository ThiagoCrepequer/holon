import { expect, it, vi } from "vitest";

import { createPrivateReviewReads } from "../src/private-review-reads.js";
const input = { workspaceId: "team", installationId: 1, repositoryId: 2 };
const scope = {
  userId: "actor",
  sessionId: "session",
  workspaceId: "team",
  repositories: [{ installationId: 1, repositoryId: 2 }],
};
const page = {
  items: [],
  nextCursor: null,
  total: 0,
  observedAt: "2026-10-09T00:00:00.000Z",
};
const review = {
  installationId: 1,
  repositoryId: 2,
  pullRequestNumber: 3,
  title: "Synthetic",
  author: "synthetic",
  pullRequestState: "open" as const,
  headSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  runId: null,
  state: "awaiting_review" as const,
  snapshotRevision: 1,
  activityAt: page.observedAt,
  observedAt: page.observedAt,
};
it("rejects foreign rows from a well-formed list response before exposing them", async () => {
  const reads = createPrivateReviewReads({
    authorize: async () => scope,
    list: async () => ({ ...page, items: [{ ...review, repositoryId: 9 }] }),
    detail: vi.fn(),
  });
  await expect(reads.list(input)).rejects.toMatchObject({
    code: "unavailable",
  });
});
it("returns complete allowlisted details after current authorization", async () => {
  const detail = {
    review,
    summary: "Synthetic",
    findings: [],
    totalFindings: 0,
    nextCursor: null,
  };
  const reads = createPrivateReviewReads({
    authorize: async () => scope,
    list: async () => page,
    detail: async () => detail,
  });
  await expect(
    reads.detail({ ...input, pullRequestNumber: 3 }),
  ).resolves.toEqual(detail);
});
it("enforces selected installation/repository before I/O and revalidates identity and grants afterwards", async () => {
  for (const after of [
    { ...scope, repositories: [] },
    { ...scope, userId: "other" },
    { ...scope, sessionId: "new" },
  ]) {
    const authorize = vi
        .fn()
        .mockResolvedValueOnce(scope)
        .mockResolvedValueOnce(after),
      list = vi.fn(async () => page);
    await expect(
      createPrivateReviewReads({ authorize, list, detail: vi.fn() }).list(
        input,
      ),
    ).rejects.toMatchObject({ code: "denied" });
    expect(list).toHaveBeenCalledTimes(1);
  }
  const list = vi.fn(async () => page),
    authorize = vi.fn(async () => ({
      ...scope,
      repositories: [{ installationId: 3, repositoryId: 2 }],
    }));
  await expect(
    createPrivateReviewReads({ authorize, list, detail: vi.fn() }).list(input),
  ).rejects.toMatchObject({ code: "denied" });
  expect(list).not.toHaveBeenCalled();
  await expect(
    createPrivateReviewReads({
      authorize: async () => scope,
      list,
      detail: vi.fn(),
    }).list(input),
  ).resolves.toEqual(page);
});
it("rejects invalid input and provider DTOs, including foreign detail", async () => {
  const reads = createPrivateReviewReads({
    authorize: async () => scope,
    list: async () => page,
    detail: vi.fn(async () => ({
      review: {
        installationId: 9,
        repositoryId: 2,
        pullRequestNumber: 3,
        title: "synthetic",
        author: "synthetic",
        pullRequestState: "open" as const,
        headSha: "a".repeat(40),
        baseSha: "b".repeat(40),
        runId: null,
        state: "awaiting_review" as const,
        snapshotRevision: 1,
        activityAt: page.observedAt,
        observedAt: page.observedAt,
      },
      summary: null,
      findings: [],
      totalFindings: 0,
      nextCursor: null,
    })),
  });
  await expect(reads.list({ ...input, limit: 51 })).rejects.toMatchObject({
    code: "invalid_request",
  });
  await expect(
    reads.detail({ ...input, pullRequestNumber: 3 }),
  ).rejects.toMatchObject({ code: "unavailable" });
  await expect(
    reads.detail({ ...input, pullRequestNumber: 0 }),
  ).rejects.toMatchObject({ code: "invalid_request" });
});
