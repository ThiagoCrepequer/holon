import type { AuthService } from "@holon/auth/server";
import type { AdmittedUser } from "@holon/contracts/dashboard";
import {
  TenancyError,
  type TenancyPersistence,
} from "@holon/db/identity/server";
import { expect, it, vi } from "vitest";

import { createDashboardHandler } from "../app/server/http-app.server.js";
import { issueSessionCsrfToken } from "../app/server/http-security.server.js";

const origin = "https://localhost";
const secret = "synthetic-http-review-secret-only-for-tests-0001";
const user: AdmittedUser = {
  id: "review_http_actor",
  name: "Synthetic HTTP actor",
  sessionId: "review_http_session",
  expiresAt: "2099-01-01T00:00:00.000Z",
  githubAccountId: "synthetic_subject",
};

function fixture() {
  const consumeRateLimit = vi.fn(async () => ({
    allowed: true,
    retryAfter: null as number | null,
  }));
  const nativeHandler = vi.fn(async () => Response.json(null));
  const refreshed = new Headers();
  refreshed.append(
    "Set-Cookie",
    "synthetic_session=refreshed; Path=/; HttpOnly; Secure",
  );
  refreshed.append(
    "Set-Cookie",
    "synthetic_state=cleared; Path=/; Max-Age=0; Secure",
  );
  const authService: AuthService = {
    appOrigin: origin,
    rateLimitStorage: {
      consume: consumeRateLimit,
    },
    handleAuthRequest: nativeHandler,
    getSession: vi.fn(async () => ({
      session: {
        user: { id: user.id, name: user.name },
        session: { id: user.sessionId, expiresAt: user.expiresAt },
      },
      headers: refreshed,
    })),
    getAdmittedUser: vi.fn(async () => ({
      user,
      status: "admitted" as const,
      headers: refreshed,
    })),
    pruneExpiredCodes: vi.fn(async () => {}),
  };
  const tenancyPersistence = {
    provisionPersonalWorkspace: vi.fn(async () => ({
      workspace: {
        id: "review_personal",
        type: "personal" as const,
        name: "Personal",
      },
      membership: {
        workspaceId: "review_personal",
        userId: user.id,
        role: "owner" as const,
      },
    })),
    createTeamWorkspace: vi.fn(async () => ({
      workspace: { id: "review_team", type: "team" as const, name: "Team" },
      membership: {
        workspaceId: "review_team",
        userId: user.id,
        role: "owner" as const,
      },
    })),
    listUserWorkspaces: vi.fn(async () => []),
    readWorkspace: vi.fn(async () => null),
    readMembership: vi.fn(async () => null),
  } satisfies TenancyPersistence;
  return {
    authService,
    consumeRateLimit,
    nativeHandler,
    tenancyPersistence,
    handle: createDashboardHandler(
      async () => new Response("Synthetic render"),
      { authService, tenancyPersistence, authSecret: secret },
    ),
    refreshed,
  };
}

it("membership denial preserves every session renewal Set-Cookie", async () => {
  const test = fixture();
  const response = await test.handle(
    new Request(`${origin}/api/workspaces/forbidden`),
    origin,
  );
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ error: { code: "denied" } });
  expect(response.headers.getSetCookie()).toEqual(
    test.refreshed.getSetCookie(),
  );
  expect(test.tenancyPersistence.readWorkspace).toHaveBeenCalledWith(
    user.id,
    "forbidden",
  );
});

it("a denied CSRF command preserves every renewal cookie and performs no mutation", async () => {
  const test = fixture();
  const response = await test.handle(
    new Request(`${origin}/api/workspaces/team`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-CSRF-Token": "synthetic_wrong_csrf",
      },
      body: JSON.stringify({
        name: "Team",
        operationId: "review_team_operation",
      }),
    }),
    origin,
  );
  expect(response.status).toBe(403);
  expect(response.headers.getSetCookie()).toEqual(
    test.refreshed.getSetCookie(),
  );
  expect(test.tenancyPersistence.createTeamWorkspace).not.toHaveBeenCalled();
  expect(test.consumeRateLimit).not.toHaveBeenCalled();
});

it.each([{ userId: "forged_other_actor" }, null, [], "invalid", 42])(
  "personal provisioning rejects invalid input %# before persistence",
  async (payload) => {
    const test = fixture();
    const csrf = await issueSessionCsrfToken(user.sessionId, secret);
    const response = await test.handle(
      new Request(`${origin}/api/workspaces/personal`, {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
        },
        body: JSON.stringify(payload),
      }),
      origin,
    );
    expect(response.status).toBe(400);
    expect(test.consumeRateLimit).not.toHaveBeenCalled();
    expect(
      test.tenancyPersistence.provisionPersonalWorkspace,
    ).not.toHaveBeenCalled();
  },
);

it.each([
  [new TenancyError("operation_conflict"), 409, "invalid_request"],
  [new TenancyError("user_not_admitted"), 403, "denied"],
  [new TenancyError("storage_corrupted"), 503, "unavailable"],
  [new TenancyError("command_unknown"), 503, "command_unknown"],
  [new Error("synthetic-private-provider-payload"), 503, "unavailable"],
] as const)(
  "command failure %# preserves safe classification and every renewal cookie",
  async (failure, status, code) => {
    const test = fixture();
    test.tenancyPersistence.createTeamWorkspace.mockRejectedValueOnce(failure);
    const csrf = await issueSessionCsrfToken(user.sessionId, secret);
    const response = await test.handle(
      new Request(`${origin}/api/workspaces/team`, {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
        },
        body: JSON.stringify({
          name: "Synthetic team",
          operationId: "safe_failure_intent",
        }),
      }),
      origin,
    );
    expect(response.status).toBe(status);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ error: { code } });
    expect(body).not.toContain("synthetic-private-provider-payload");
    expect(response.headers.getSetCookie()).toEqual(
      test.refreshed.getSetCookie(),
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  },
);

it("disconnected session preserves renewal cookies and performs no private query", async () => {
  const test = fixture();
  test.authService.getAdmittedUser = async () => ({
    user: null,
    status: "disconnected",
    headers: test.refreshed,
  });
  const response = await test.handle(
    new Request(`${origin}/api/workspaces`),
    origin,
  );
  expect(response.status).toBe(401);
  expect(await response.json<{ error: { code: string } }>()).toMatchObject({
    error: { code: "reconnect_required" },
  });
  expect(response.headers.getSetCookie()).toEqual(
    test.refreshed.getSetCookie(),
  );
  expect(test.tenancyPersistence.listUserWorkspaces).not.toHaveBeenCalled();
});

it("a denied durable budget preserves cookies, performs no command and offers bounded recovery", async () => {
  const test = fixture();
  test.authService.rateLimitStorage.consume = vi.fn(async () => ({
    allowed: false,
    retryAfter: 39,
  }));
  const csrf = await issueSessionCsrfToken(user.sessionId, secret);
  const response = await test.handle(
    new Request(`${origin}/api/workspaces/team`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf,
      },
      body: JSON.stringify({
        name: "Synthetic team",
        operationId: "rate_denied_intent",
      }),
    }),
    origin,
  );
  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("39");
  expect(await response.json<{ error: { code: string } }>()).toMatchObject({
    error: { code: "rate_limited" },
  });
  expect(response.headers.getSetCookie()).toEqual(
    test.refreshed.getSetCookie(),
  );
  expect(test.tenancyPersistence.createTeamWorkspace).not.toHaveBeenCalled();
});

it.each([
  ["GET", {}, undefined, 405],
  ["HEAD", {}, undefined, 405],
  [
    "POST",
    { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" },
    "{}",
    403,
  ],
  ["POST", { "Content-Type": "text/plain" }, "{}", 400],
  ["POST", { "Content-Type": "application/json" }, '{"unexpected":true}', 400],
] as const)(
  "unsafe logout %# is rejected before native revocation",
  async (method, extra, body, status) => {
    const test = fixture();
    const csrf = await issueSessionCsrfToken(user.sessionId, secret);
    const headers = new Headers({ Origin: origin, "X-CSRF-Token": csrf });
    new Headers(extra).forEach((value, key) => headers.set(key, value));
    const response = await test.handle(
      new Request(`${origin}/api/auth/sign-out`, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
      }),
      origin,
    );
    expect(response.status).toBe(status);
    expect(test.nativeHandler).not.toHaveBeenCalled();
  },
);

it.each([
  [{ "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" }, 403],
  [{ "Content-Type": "text/plain" }, 400],
] as const)(
  "unsafe anonymous login %# is rejected before the native flow",
  async (extra, status) => {
    const test = fixture();
    const headers = new Headers({ Origin: origin });
    new Headers(extra).forEach((value, key) => headers.set(key, value));
    const response = await test.handle(
      new Request(`${origin}/api/auth/sign-in/social`, {
        method: "POST",
        headers,
        body: "{}",
      }),
      origin,
    );
    expect(response.status).toBe(status);
    expect(test.nativeHandler).not.toHaveBeenCalled();
  },
);
