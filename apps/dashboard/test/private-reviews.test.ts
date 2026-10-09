import type { AuthService } from "@holon/auth/server";
import { expect, it, vi } from "vitest";

import { createDashboardHandler } from "../app/server/http-app.server.js";
import type { DashboardServices } from "../app/server/http-context.server.js";
import { readPrivateReviews } from "../app/server/private-reviews.server.js";
const origin = "https://dashboard.example.invalid";
const actor = {
  id: "actor",
  name: "Synthetic",
  sessionId: "session",
  githubAccountId: "101",
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const observedAt = "2026-10-09T00:00:00.000Z";
const review = {
  installationId: 1,
  repositoryId: 2,
  pullRequestNumber: 3,
  title: "</script><script>hostile()</script>",
  author: "synthetic",
  pullRequestState: "open" as const,
  headSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  runId: null,
  state: "awaiting_review" as const,
  snapshotRevision: 1,
  activityAt: observedAt,
  observedAt,
};
function setup() {
  const auth = {
    getAdmittedUser: vi.fn(async () => ({
      user: actor,
      status: "admitted" as const,
      headers: new Headers({ "Set-Cookie": "synthetic=refreshed" }),
    })),
    rateLimitStorage: {
      consume: vi.fn(async () => ({ allowed: true, retryAfter: null })),
    },
  };
  const authorizeReviews = vi.fn(async () => ({
    userId: actor.id,
    workspaceId: "team",
    repositories: [{ installationId: 1, repositoryId: 2 }],
  }));
  const list = vi.fn(async () => ({
      items: [review],
      total: 1,
      nextCursor: null,
      observedAt,
    })),
    detail = vi.fn(async () => ({
      status: "available" as const,
      generation: 1,
      detail: {
        review,
        summary: null,
        findings: [],
        totalFindings: 0,
        nextCursor: null,
      },
    }));
  const services = {
    authService: auth as unknown as AuthService,
    collaboration: {
      authorizeReviews,
    } as unknown as DashboardServices["collaboration"],
    reviewProjection: {
      list,
      readScope: vi.fn(async () => ({
        generation: 1,
        state: "active" as "active" | "rebuilding",
      })),
    },
    reviewCore: { detail },
  };
  return {
    auth,
    authorizeReviews,
    list,
    detail,
    services,
    handle: createDashboardHandler(async () => new Response("SSR"), services),
  };
}
it("API and direct SSR case produce identical allowlisted DTOs with current admission and no-store", async () => {
  const f = setup();
  for (const kind of ["list", "detail"] as const) {
    const url = `${origin}/api/reviews/${kind}?workspace=team&installation=1&repository=2${kind === "detail" ? "&pullRequest=3" : ""}`;
    const response = await f.handle(new Request(url), origin),
      dto = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(dto).toEqual(
      await readPrivateReviews(new Request(url), f.services, kind, []),
    );
    expect(JSON.stringify(dto)).not.toContain("githubAccountId");
    expect(JSON.stringify(dto)).not.toContain("authSecret");
  }
  expect(f.list).toHaveBeenCalledTimes(2);
  expect(f.detail).toHaveBeenCalledTimes(2);
});
it("blocks list and detail while rebuilding, on a concurrent generation change and on an old core generation", async () => {
  const f = setup();
  const listURL = `${origin}/api/reviews/list?workspace=team&installation=1&repository=2`;
  const detailURL = `${origin}/api/reviews/detail?workspace=team&installation=1&repository=2&pullRequest=3`;
  for (const url of [listURL, detailURL]) {
    f.services.reviewProjection.readScope.mockResolvedValueOnce({
      generation: 2,
      state: "rebuilding",
    });
    expect((await f.handle(new Request(url), origin)).status).toBe(503);
  }
  expect(f.list).not.toHaveBeenCalled();
  expect(f.detail).not.toHaveBeenCalled();
  f.services.reviewProjection.readScope
    .mockResolvedValueOnce({ generation: 1, state: "active" })
    .mockResolvedValueOnce({ generation: 2, state: "active" });
  expect((await f.handle(new Request(listURL), origin)).status).toBe(503);
  f.services.reviewProjection.readScope.mockResolvedValueOnce({
    generation: 2,
    state: "active",
  });
  expect((await f.handle(new Request(detailURL), origin)).status).toBe(503);
});
it("rechecks current ACL after the final projection generation read", async () => {
  const f = setup();
  let scopeReads = 0;
  f.services.reviewProjection.readScope.mockImplementation(async () => {
    if (++scopeReads === 2)
      f.authorizeReviews.mockResolvedValue({
        userId: actor.id,
        workspaceId: "team",
        repositories: [],
      });
    return { generation: 1, state: "active" };
  });
  const response = await f.handle(
    new Request(
      `${origin}/api/reviews/list?workspace=team&installation=1&repository=2`,
    ),
    origin,
  );
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain("hostile");
});
it("denies scope before storage and membership/session revocation after storage without returning private data", async () => {
  const f = setup(),
    url = `${origin}/api/reviews/list?workspace=team&installation=1&repository=2`;
  f.authorizeReviews.mockResolvedValueOnce({
    ...(await f.authorizeReviews()),
    repositories: [],
  });
  const denied = await f.handle(new Request(url), origin);
  expect(denied.status).toBe(403);
  expect(f.list).not.toHaveBeenCalled();
  f.authorizeReviews
    .mockResolvedValueOnce({
      userId: actor.id,
      workspaceId: "team",
      repositories: [{ installationId: 1, repositoryId: 2 }],
    })
    .mockResolvedValueOnce({
      userId: actor.id,
      workspaceId: "team",
      repositories: [],
    });
  const revoked = await f.handle(new Request(url), origin);
  expect(revoked.status).toBe(403);
  expect(JSON.stringify(await revoked.json())).not.toContain("hostile");
  f.auth.getAdmittedUser.mockResolvedValueOnce({
    user: null,
    status: "disconnected",
    headers: new Headers(),
  } as never);
  expect((await f.handle(new Request(url), origin)).status).toBe(401);
});
it("bounds parameters and maps malformed/unavailable RPC and cursor errors to stable responses", async () => {
  const f = setup(),
    base = `${origin}/api/reviews/`;
  for (const query of [
    "workspace=&installation=1&repository=2",
    "workspace=team&installation=1&repository=2&limit=51",
    "workspace=team&installation=1&repository=2&cursor=" + "x".repeat(1025),
  ])
    expect(
      (await f.handle(new Request(base + "list?" + query), origin)).status,
    ).toBe(400);
  const detailURL =
    base + "detail?workspace=team&installation=1&repository=2&pullRequest=3";
  for (const value of [
    { status: "revision_changed" },
    { status: "unavailable" },
    { status: "invalid_request" },
    {},
  ]) {
    f.detail.mockResolvedValueOnce(value as never);
    expect((await f.handle(new Request(detailURL), origin)).status).toBe(
      value.status === "revision_changed"
        ? 409
        : value.status === "invalid_request"
          ? 400
          : 503,
    );
  }
  f.list.mockRejectedValueOnce(new Error("invalid_review_cursor"));
  expect(
    (
      await f.handle(
        new Request(base + "list?workspace=team&installation=1&repository=2"),
        origin,
      )
    ).status,
  ).toBe(400);
  const aborted = new AbortController();
  aborted.abort();
  await expect(
    readPrivateReviews(
      new Request(detailURL, { signal: aborted.signal }),
      f.services,
      "detail",
      [],
    ),
  ).rejects.toMatchObject({ status: 503 });
});
