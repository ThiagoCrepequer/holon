import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  bindReviewIdentity,
  reviewIdentity,
  reviewClient,
  loadReviews,
  createReviewQueryClient,
} from "../app/features/reviews/review-client.js";
import { reviewQueryKey, reviewParameters } from "../app/review-parameters.js";
const identity = reviewIdentity("actor", "session"),
  date = "2026-10-09T00:00:00.000Z";
const url = new URL(
  "https://dashboard.invalid/reviews?workspace=team&installation=1&repository=2",
);
const dto = {
  identity: { userId: "actor", sessionId: "session" },
  result: { items: [], total: 0, nextCursor: null, observedAt: date },
};
beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  bindReviewIdentity(identity);
});
afterEach(() => {
  bindReviewIdentity(null);
  vi.unstubAllGlobals();
});
it("uses disabled Query observers and preserves server timestamps for explicit reads only", async () => {
  const client = createReviewQueryClient();
  expect(client.getDefaultOptions().queries).toMatchObject({
    enabled: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const fetch = vi.fn(async () => Response.json(dto));
  vi.stubGlobal("fetch", fetch);
  await loadReviews(url, "list", new AbortController().signal);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(
    reviewClient().getQueryState(reviewQueryKey(identity, url, "list"))
      ?.dataUpdatedAt,
  ).toBe(Date.parse(date));
  expect(reviewParameters(url, "list")).toMatchObject({
    limit: 50,
    cursor: null,
    status: null,
  });
  client.clear();
});
it("cancelled reads and a previous user's late reply cannot populate a new identity", async () => {
  let resolve!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>((r) => (resolve = r))),
  );
  const controller = new AbortController();
  const reading = loadReviews(url, "list", controller.signal);
  controller.abort();
  bindReviewIdentity(reviewIdentity("other", "other-session"));
  resolve(Response.json(dto));
  await reading;
  expect(reviewClient().getQueryCache().getAll()).toEqual([]);
});
it("a late denied old filter cannot revoke a newer confirmed view of the same scope", async () => {
  let resolveOld!: (value: Response) => void;
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () => new Promise<Response>((r) => (resolveOld = r)),
    )
    .mockResolvedValueOnce(Response.json(dto));
  vi.stubGlobal("fetch", fetch);
  const previous = loadReviews(url, "list", new AbortController().signal).catch(
      () => {},
    ),
    newer = new URL(url);
  newer.searchParams.set("search", "newer");
  await loadReviews(newer, "list", new AbortController().signal);
  resolveOld(Response.json({ error: { code: "denied" } }, { status: 403 }));
  await previous;
  expect(
    reviewClient().getQueryData(reviewQueryKey(identity, newer, "list")),
  ).toEqual(dto.result);
});
it("current denial clears the scope; session loss clears every dataset; malformed data fails closed", async () => {
  for (const status of [403, 401, 409]) {
    bindReviewIdentity(identity);
    reviewClient().setQueryData(
      reviewQueryKey(identity, url, "list"),
      dto.result,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { code: "denied" } }, { status }),
      ),
    );
    await expect(
      loadReviews(url, "list", new AbortController().signal),
    ).rejects.toThrow();
    expect(
      reviewClient().getQueryData(reviewQueryKey(identity, url, "list")),
    ).toBeUndefined();
  }
  bindReviewIdentity(identity);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        identity: dto.identity,
        result: { ...dto.result, token: "private" },
      }),
    ),
  );
  await expect(
    loadReviews(url, "list", new AbortController().signal),
  ).rejects.toThrow();
  expect(reviewClient().getQueryCache().getAll()).toEqual([]);
});
it("checks detail identity, scope and protocol before caching", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        ...dto,
        identity: { userId: "other", sessionId: "different" },
      }),
    ),
  );
  await expect(
    loadReviews(url, "list", new AbortController().signal),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    loadReviews(url, "list", new AbortController().signal),
  ).rejects.toMatchObject({ status: 401 });
  bindReviewIdentity(identity);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        identity: dto.identity,
        result: {
          review: {
            installationId: 9,
            repositoryId: 2,
            pullRequestNumber: 3,
            title: "synthetic",
            author: "synthetic",
            pullRequestState: "open",
            headSha: "a".repeat(40),
            baseSha: "b".repeat(40),
            runId: null,
            state: "awaiting_review",
            snapshotRevision: 1,
            activityAt: date,
            observedAt: date,
          },
          summary: null,
          findings: [],
          totalFindings: 0,
          nextCursor: null,
        },
      }),
    ),
  );
  const detailURL = new URL(url);
  detailURL.searchParams.set("pullRequest", "3");
  await expect(
    loadReviews(detailURL, "detail", new AbortController().signal),
  ).rejects.toMatchObject({ status: 403 });
});
