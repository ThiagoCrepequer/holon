import type { AuthService } from "@holon/auth/server";
import {
  dashboardErrorSchema,
  type AdmittedUser,
  type WorkspaceDto,
  type WorkspaceMembershipDto,
} from "@holon/contracts/dashboard";
import type { TenancyPersistence } from "@holon/db/identity/server";
import { expect, it } from "vitest";

import { createDashboardHandler } from "../app/server/http-app.server.js";
import {
  configuredOrigin,
  safeReturnPath,
  readCommand,
  secureResponse,
  errorResponse,
  HttpBoundaryError,
  issueSessionCsrfToken,
  nonce,
} from "../app/server/http-security.server.js";
const origin = "https://dashboard.example.invalid";
const session = {
  sessionId: "synthetic-session",
  csrfToken: "synthetic-csrf-token-at-least-32-bytes",
};
function command(
  body: BodyInit | null = JSON.stringify({ language: "en" }),
  extra: HeadersInit = {},
  method = "POST",
) {
  const headers = new Headers({
    Origin: origin,
    "Content-Type": "application/json; charset=utf-8",
    "X-CSRF-Token": session.csrfToken,
    "Sec-Fetch-Site": "same-origin",
  });
  new Headers(extra).forEach((value, key) => headers.set(key, value));
  return new Request(
    `${origin}/api/preferences`,
    method === "GET" || method === "HEAD"
      ? { method, headers }
      : { method, headers, body },
  );
}
it("origin/redirect authority comes from config, rejecting ambiguous or hostile destinations", () => {
  expect(configuredOrigin(origin)).toBe(origin);
  expect(configuredOrigin("http://127.0.0.1:8794")).toBe(
    "http://127.0.0.1:8794",
  );
  for (const value of [
    "http://evil.test",
    "https://user:pass@dashboard.example.invalid",
    "https://dashboard.example.invalid/path",
    "https://dashboard.example.invalid?q=1",
    "https://dashboard.example.invalid/#hash",
  ])
    expect(() => configuredOrigin(value)).toThrow(HttpBoundaryError);
  expect(safeReturnPath("/w/opaque/reviews?sort=newest", origin)).toBe(
    "/w/opaque/reviews?sort=newest",
  );
  expect(
    safeReturnPath("/w/opaque/reviews?search=needs%20review", origin),
  ).toBe("/w/opaque/reviews?search=needs%20review");
  for (const value of [
    "https://evil.test/",
    "//evil.test/",
    "/\\evil.test",
    "/%2fevil.test",
    "/../secret",
    "/path#hash",
    "/path with spaces",
  ])
    expect(() => safeReturnPath(value, origin)).toThrow(HttpBoundaryError);
});
it("valid commands require session-bound CSRF, exact origin, POST and JSON", async () => {
  expect(await readCommand(command(), origin, session)).toEqual({
    language: "en",
  });
  for (const [request, identity] of [
    [command(null, {}, "GET"), session],
    [command(null, {}, "HEAD"), session],
    [command("{}", { "Content-Type": "text/plain" }), session],
    [command("{}", { Origin: "https://evil.test" }), session],
    [command("{}", { "Sec-Fetch-Site": "cross-site" }), session],
    [command("{}", { "Sec-Fetch-Site": "same-site" }), session],
    [command("{}", { "X-CSRF-Token": "" }), session],
    [command("{}", { "X-CSRF-Token": "wrong" }), session],
    [command(), null],
    [command(), { sessionId: "", csrfToken: session.csrfToken }],
    [command(), { sessionId: "id", csrfToken: "short" }],
    [new Request("https://evil.test/api", { method: "POST" }), session],
  ] as const)
    await expect(readCommand(request, origin, identity)).rejects.toBeInstanceOf(
      HttpBoundaryError,
    );
  expect(
    await readCommand(
      command("{}", { "Sec-Fetch-Site": "none" }),
      origin,
      session,
    ),
  ).toEqual({});
  const withoutFetchMetadata = command();
  withoutFetchMetadata.headers.delete("Sec-Fetch-Site");
  expect(await readCommand(withoutFetchMetadata, origin, session)).toEqual({
    language: "en",
  });
});
it("body limits apply to the stream even without a reliable length header", async () => {
  await expect(
    readCommand(command("x".repeat(20)), origin, session, 10),
  ).rejects.toMatchObject({ status: 413 });
  await expect(
    readCommand(command("{}", { "Content-Length": "20" }), origin, session, 10),
  ).rejects.toMatchObject({ status: 413 });
  await expect(
    readCommand(command(null), origin, session),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    readCommand(command("not-json"), origin, session),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    readCommand(command(new Uint8Array([255])), origin, session),
  ).rejects.toMatchObject({ status: 400 });
  expect(await readCommand(command("[]"), origin, session, 2)).toEqual([]);
});
it("errors and headers disclose no arbitrary exception or session secret and preserve all cookies", async () => {
  const response = errorResponse(
    new Error("token=private email=private@example.invalid body=secret"),
  );
  expect(response.status).toBe(503);
  expect(await response.text()).not.toMatch(/private|secret|token=/);
  for (const code of [
    "denied",
    "reconnect_required",
    "command_unknown",
    "rate_limited",
  ] as const) {
    const error = errorResponse(new HttpBoundaryError(code, 403));
    expect(dashboardErrorSchema.parse(await error.json()).error.code).toBe(
      code,
    );
  }
  const original = new Response("private");
  original.headers.append("Set-Cookie", "a=one; HttpOnly");
  original.headers.append("Set-Cookie", "b=two; HttpOnly");
  const first = nonce(),
    second = nonce();
  expect(first).not.toBe(second);
  const safe = secureResponse(original, first);
  expect(safe.headers.getSetCookie()).toEqual(original.headers.getSetCookie());
  expect(safe.headers.get("Cache-Control")).toBe("private, no-store");
  expect(safe.headers.get("Content-Security-Policy")).toContain(
    `'nonce-${first}'`,
  );
  expect(safe.headers.get("Content-Security-Policy")).not.toMatch(
    /unsafe-inline|unsafe-eval/,
  );
  expect(safe.headers.get("X-Content-Type-Options")).toBe("nosniff");
});
it("SSR/API share HTTP boundaries and the bootstrap exposes no command or fake auth", async () => {
  const calls: Request[] = [];
  const handle = createDashboardHandler(async (request) => {
    calls.push(request);
    return new Response("html");
  });
  expect(await (await handle(new Request(`${origin}/`), origin)).text()).toBe(
    "html",
  );
  expect(calls).toHaveLength(1);
  expect(
    await (await handle(new Request(`${origin}/api/health`), origin)).json(),
  ).toEqual({ status: "ok" });
  for (const path of ["/api/auth/get-session", "/api/send", "/api/unknown"])
    expect((await handle(new Request(origin + path), origin)).status).toBe(404);
  expect((await handle(command(), origin)).status).toBe(503);
  expect(
    (
      await handle(
        new Request(`${origin}/api/unknown`, { method: "POST" }),
        origin,
      )
    ).status,
  ).toBe(405);
  expect(
    (await handle(new Request(`${origin}/?q=${"x".repeat(2049)}`), origin))
      .status,
  ).toBe(414);
  expect(
    (
      await handle(
        new Request("https://evil.test/", {
          headers: { "X-Forwarded-Host": "dashboard.example.invalid" },
        }),
        origin,
      )
    ).status,
  ).toBe(403);
  expect((await handle(new Request(origin), "http://evil.test")).status).toBe(
    503,
  );
  expect(
    (await handle(new Request(origin, { method: "HEAD" }), origin)).status,
  ).toBe(200);
  const failed = createDashboardHandler(async () => {
    throw new Error("provider-secret");
  });
  expect(
    await (await failed(new Request(origin), origin)).text(),
  ).not.toContain("provider-secret");
});

function createFakeAuthService(
  options: {
    admitted?: boolean;
    userId?: string;
    sessionId?: string;
  } = {},
) {
  const admitted = options.admitted ?? true;
  const userId = options.userId ?? "u-synthetic-1";
  const sessionId = options.sessionId ?? "s-synthetic-1";

  const authService: AuthService = {
    appOrigin: origin,
    rateLimitStorage: {
      consume: async () => ({ allowed: true, retryAfter: null }),
    },
    async handleAuthRequest(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === "/api/auth/session") {
        if (!admitted) {
          return Response.json(null, {
            headers: { "Cache-Control": "private, no-store" },
          });
        }
        const res = Response.json(
          {
            user: { id: userId, name: "Alice" },
            session: { id: sessionId, expiresAt: "2030-01-01T00:00:00Z" },
          },
          { headers: { "Cache-Control": "private, no-store" } },
        );
        res.headers.append("Set-Cookie", "synthetic_auth=1; HttpOnly");
        return res;
      }
      if (url.pathname === "/api/auth/sign-in/social") {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://github.com/login/oauth/authorize" },
        });
      }
      if (url.pathname === "/api/auth/sign-out") {
        return Response.json({ success: true });
      }
      return new Response(null, { status: 404 });
    },
    async getSession() {
      if (!admitted) {
        return { session: null, headers: new Headers() };
      }
      const headers = new Headers();
      headers.append("Set-Cookie", "session_touch=1");
      return {
        session: {
          user: { id: userId, name: "Alice" },
          session: { id: sessionId, expiresAt: "2030-01-01T00:00:00Z" },
        },
        headers,
      };
    },
    async getAdmittedUser() {
      if (!admitted) {
        return { user: null, status: "anonymous", headers: new Headers() };
      }
      const headers = new Headers();
      headers.append("Set-Cookie", "user_touch=1");
      return {
        status: "admitted",
        user: {
          id: userId,
          name: "Alice",
          sessionId,
          expiresAt: "2030-01-01T00:00:00Z",
          githubAccountId: "gh-1",
        },
        headers,
      };
    },
    async listSessions() {
      return [
        {
          id: sessionId,
          createdAt: "2026-10-01T00:00:00Z",
          expiresAt: "2030-01-01T00:00:00Z",
          isCurrent: true,
          label: "chrome",
        },
      ];
    },
    async revokeSession() {
      return true;
    },
    async revokeAllSessions() {
      return 1;
    },
    async clearSessionCookies() {
      return [];
    },
    async pruneExpiredCodes() {},
  };
  return authService;
}

function createFakeTenancyPersistence() {
  const workspaces = new Map<
    string,
    { id: string; name: string; type: "personal" | "team" }
  >();
  let personalCreated = 0;
  let teamCreated = 0;

  const tenancy: TenancyPersistence = {
    async provisionPersonalWorkspace(actor: AdmittedUser) {
      const userId = actor.id;
      personalCreated += 1;
      const ws = {
        id: `ws-personal-${userId}`,
        name: "Personal",
        type: "personal" as const,
      };
      workspaces.set(ws.id, ws);
      return {
        workspace: ws,
        membership: { workspaceId: ws.id, userId, role: "owner" as const },
      };
    },
    async createTeamWorkspace(actor: AdmittedUser, input) {
      const actorUserId = actor.id;
      teamCreated += 1;
      const ws = {
        id: `ws-team-${input.operationId}`,
        name: input.name,
        type: "team" as const,
      };
      workspaces.set(ws.id, ws);
      return {
        workspace: ws,
        membership: {
          workspaceId: ws.id,
          userId: actorUserId,
          role: "owner" as const,
        },
      };
    },
    async listUserWorkspaces() {
      return [...workspaces.values()].map((ws) => ({
        workspace: ws,
        role: "owner" as const,
      }));
    },
    async readWorkspace(userId: string, workspaceId: string) {
      const ws = workspaces.get(workspaceId);
      if (!ws) return null;
      return { workspace: ws, role: "owner" as const };
    },
    async createReauthIntent() {
      throw new Error("Unexpected governance command");
    },
    async readPendingReauthContext() {
      return null;
    },
    async confirmReauthIntent() {
      throw new Error("Unexpected governance command");
    },
    async promoteMember() {
      throw new Error("Unexpected governance command");
    },
    async demoteMember() {
      throw new Error("Unexpected governance command");
    },
    async removeMember() {
      throw new Error("Unexpected governance command");
    },
    async leaveWorkspace() {
      throw new Error("Unexpected governance command");
    },
    async readMembership(userId: string, workspaceId: string) {
      if (!workspaces.has(workspaceId)) return null;
      return { workspaceId, role: "owner" as const };
    },
  };

  return { tenancy, getCounts: () => ({ personalCreated, teamCreated }) };
}

it("issueSessionCsrfToken derives a 64-character token bound to session and verifies in readCommand", async () => {
  const secret = "secret-1-at-least-32-chars-long-12345678";
  const token1 = await issueSessionCsrfToken("sess-1", secret);
  const token2 = await issueSessionCsrfToken("sess-2", secret);
  expect(token1).toHaveLength(64);
  expect(token1).not.toBe(token2);

  const req = command(JSON.stringify({ language: "en" }), {
    "X-CSRF-Token": token1,
  });
  expect(
    await readCommand(req, origin, { sessionId: "sess-1", csrfToken: token1 }),
  ).toEqual({ language: "en" });

  await expect(
    readCommand(req, origin, { sessionId: "sess-1", csrfToken: token2 }),
  ).rejects.toBeInstanceOf(HttpBoundaryError);
});

it("integrates auth routes: session returns CSRF token, does not provision personal workspace, handles sign-in and sign-out", async () => {
  const secret = "secret-1-at-least-32-chars-long-12345678";
  const authService = createFakeAuthService();
  const { tenancy, getCounts } = createFakeTenancyPersistence();

  const handle = createDashboardHandler(async () => new Response("html"), {
    authService,
    tenancyPersistence: tenancy,
    authSecret: secret,
  });

  const sessionRes = await handle(
    new Request(`${origin}/api/auth/session`),
    origin,
  );
  expect(sessionRes.status).toBe(200);
  const csrfToken = sessionRes.headers.get("X-CSRF-Token");
  expect(csrfToken).toHaveLength(64);
  expect(sessionRes.headers.get("Set-Cookie")).toContain("holon_csrf=");
  expect(getCounts().personalCreated).toBe(0);

  const signInRes = await handle(
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ provider: "github" }),
    }),
    origin,
  );
  expect(signInRes.status).toBe(302);

  const signOutRes = await handle(
    new Request(`${origin}/api/auth/sign-out`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken!,
      },
      body: "{}",
    }),
    origin,
  );
  expect(signOutRes.status).toBe(200);

  const unknownAuth = await handle(
    new Request(`${origin}/api/auth/unknown`),
    origin,
  );
  expect(unknownAuth.status).toBe(404);
});

it("integrates tenancy routes: verifies admission and session CSRF on mutations, preserves Set-Cookie", async () => {
  const secret = "secret-1-at-least-32-chars-long-12345678";
  const authService = createFakeAuthService({
    sessionId: "s-1",
    userId: "u-1",
  });
  const { tenancy, getCounts } = createFakeTenancyPersistence();
  const csrfToken = await issueSessionCsrfToken("s-1", secret);

  const handle = createDashboardHandler(async () => new Response("html"), {
    authService,
    tenancyPersistence: tenancy,
    authSecret: secret,
  });

  // GET /api/workspaces (initially empty)
  const listRes = await handle(new Request(`${origin}/api/workspaces`), origin);
  expect(listRes.status).toBe(200);
  expect(await listRes.json()).toEqual({ workspaces: [] });
  expect(listRes.headers.get("Set-Cookie")).toContain("user_touch=1");

  // POST /api/workspaces/personal without CSRF -> 403
  const deniedPersonal = await handle(
    new Request(`${origin}/api/workspaces/personal`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: "{}",
    }),
    origin,
  );
  expect(deniedPersonal.status).toBe(403);

  // POST /api/workspaces/personal with valid CSRF -> 200
  const personalRes = await handle(
    new Request(`${origin}/api/workspaces/personal`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
        "Sec-Fetch-Site": "same-origin",
      },
      body: "{}",
    }),
    origin,
  );
  expect(personalRes.status).toBe(200);
  const personalJson = await personalRes.json<{
    workspace: WorkspaceDto;
    membership: WorkspaceMembershipDto;
  }>();
  expect(personalJson.workspace.id).toBe("ws-personal-u-1");
  expect(personalRes.headers.get("Set-Cookie")).toContain("user_touch=1");
  expect(getCounts().personalCreated).toBe(1);

  // POST /api/workspaces/team with invalid body -> 400
  const badTeamRes = await handle(
    new Request(`${origin}/api/workspaces/team`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({ name: "", operationId: "op-1" }),
    }),
    origin,
  );
  expect(badTeamRes.status).toBe(400);

  // POST /api/workspaces/team with valid body -> 200
  const teamRes = await handle(
    new Request(`${origin}/api/workspaces/team`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({ name: "Core Team", operationId: "op-1" }),
    }),
    origin,
  );
  expect(teamRes.status).toBe(200);
  const teamJson = await teamRes.json<{
    workspace: WorkspaceDto;
    membership: WorkspaceMembershipDto;
  }>();
  expect(teamJson.workspace.name).toBe("Core Team");
  expect(getCounts().teamCreated).toBe(1);

  // GET /api/workspaces/:id -> 200
  const getWsRes = await handle(
    new Request(`${origin}/api/workspaces/ws-personal-u-1`),
    origin,
  );
  expect(getWsRes.status).toBe(200);

  // GET /api/workspaces/:id with unknown ID -> 404
  const notFoundWsRes = await handle(
    new Request(`${origin}/api/workspaces/ws-missing`),
    origin,
  );
  expect(notFoundWsRes.status).toBe(404);

  // GET /api/workspaces/:id with invalid ID format -> 400
  const badIdWsRes = await handle(
    new Request(`${origin}/api/workspaces/invalid%20id!`),
    origin,
  );
  expect(badIdWsRes.status).toBe(400);

  // Unadmitted actor gets 403 on all tenancy endpoints
  const unadmittedAuth = createFakeAuthService({ admitted: false });
  const unadmittedHandle = createDashboardHandler(
    async () => new Response("html"),
    {
      authService: unadmittedAuth,
      tenancyPersistence: tenancy,
      authSecret: secret,
    },
  );
  expect(
    (await unadmittedHandle(new Request(`${origin}/api/workspaces`), origin))
      .status,
  ).toBe(403);
  expect(
    (
      await unadmittedHandle(
        new Request(`${origin}/api/workspaces/personal`, {
          method: "POST",
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: "{}",
        }),
        origin,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await unadmittedHandle(
        new Request(`${origin}/api/workspaces/team`, {
          method: "POST",
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify({ name: "Team", operationId: "op-1" }),
        }),
        origin,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await unadmittedHandle(
        new Request(`${origin}/api/workspaces/ws-personal-u-1`),
        origin,
      )
    ).status,
  ).toBe(403);

  // POST /api/workspaces/team without CSRF -> 403
  expect(
    (
      await handle(
        new Request(`${origin}/api/workspaces/team`, {
          method: "POST",
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: "Team", operationId: "op-1" }),
        }),
        origin,
      )
    ).status,
  ).toBe(403);

  // Unallowed methods on tenancy endpoints -> 405
  expect(
    (
      await handle(
        new Request(`${origin}/api/workspaces`, { method: "POST" }),
        origin,
      )
    ).status,
  ).toBe(405);
  expect(
    (
      await handle(
        new Request(`${origin}/api/workspaces/personal`, { method: "GET" }),
        origin,
      )
    ).status,
  ).toBe(405);
  expect(
    (
      await handle(
        new Request(`${origin}/api/workspaces/ws-personal-u-1`, {
          method: "POST",
        }),
        origin,
      )
    ).status,
  ).toBe(405);

  // Unconfigured services return 503 on tenancy routes
  const unconfiguredHandle = createDashboardHandler(
    async () => new Response("html"),
  );
  expect(
    (await unconfiguredHandle(new Request(`${origin}/api/workspaces`), origin))
      .status,
  ).toBe(503);
  expect(
    (
      await unconfiguredHandle(
        new Request(`${origin}/api/workspaces/ws-1`),
        origin,
      )
    ).status,
  ).toBe(503);
  expect(
    (
      await unconfiguredHandle(
        new Request(`${origin}/api/workspaces/personal`, {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: "{}",
        }),
        origin,
      )
    ).status,
  ).toBe(503);
  expect(
    (
      await unconfiguredHandle(
        new Request(`${origin}/api/workspaces/team`, {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Team", operationId: "op-1" }),
        }),
        origin,
      )
    ).status,
  ).toBe(503);
});

it("ORM and database exceptions return 503 unavailable without leaking SQL or schema internals and preserve cookies", async () => {
  const authService = createFakeAuthService({ admitted: true });
  const ormFaultPersistence: TenancyPersistence = {
    async createReauthIntent() {
      throw new Error("Unexpected governance command");
    },
    async readPendingReauthContext() {
      return null;
    },
    async confirmReauthIntent() {
      throw new Error("Unexpected governance command");
    },
    async promoteMember() {
      throw new Error("Unexpected governance command");
    },
    async demoteMember() {
      throw new Error("Unexpected governance command");
    },
    async removeMember() {
      throw new Error("Unexpected governance command");
    },
    async leaveWorkspace() {
      throw new Error("Unexpected governance command");
    },

    async provisionPersonalWorkspace() {
      throw new Error(
        "DrizzleError: table workspace constraint violated: SELECT * FROM workspace",
      );
    },
    async createTeamWorkspace() {
      throw new Error(
        "D1_ERROR: SQLITE_CONSTRAINT: UNIQUE constraint failed: workspace.id",
      );
    },
    async listUserWorkspaces() {
      throw new Error("DrizzleError: failed query on table membership");
    },
    async readWorkspace() {
      throw new Error("D1_ERROR: SQLite error: storage_authority_mismatch");
    },
    async readMembership() {
      return null;
    },
  };

  const handle = createDashboardHandler(async () => new Response("html"), {
    authService,
    tenancyPersistence: ormFaultPersistence,
    authSecret: "test-auth-secret-minimum-32-chars-long",
  });

  // GET /api/workspaces with ORM fault
  const listRes = await handle(new Request(`${origin}/api/workspaces`), origin);
  expect(listRes.status).toBe(503);
  const listBody = await listRes.text();
  expect(listBody).not.toMatch(
    /DrizzleError|SELECT|SQLITE|workspace|membership/,
  );
  const listJson = JSON.parse(listBody);
  expect(dashboardErrorSchema.parse(listJson).error.code).toBe("unavailable");

  // POST /api/workspaces/team with ORM / D1 fault
  const csrf = await issueSessionCsrfToken(
    "s-synthetic-1",
    "test-auth-secret-minimum-32-chars-long",
  );
  const teamRes = await handle(
    new Request(`${origin}/api/workspaces/team`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf,
      },
      body: JSON.stringify({ name: "Engineering", operationId: "op-orm-fail" }),
    }),
    origin,
  );
  expect(teamRes.status).toBe(503);
  const teamBody = await teamRes.text();
  expect(teamBody).not.toMatch(/D1_ERROR|SQLITE_CONSTRAINT|workspace/);
  const teamJson = JSON.parse(teamBody);
  expect(dashboardErrorSchema.parse(teamJson).error.code).toBe("unavailable");
});

it("future workspace commands like leave remain nonexistent 404 on GET/HEAD and 405 on POST", async () => {
  const unconfigured = createDashboardHandler(async () => new Response("html"));
  expect(
    (await unconfigured(new Request(`${origin}/api/workspaces/leave`), origin))
      .status,
  ).toBe(404);
  expect(
    (
      await unconfigured(
        new Request(`${origin}/api/workspaces/leave`, { method: "HEAD" }),
        origin,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await unconfigured(
        new Request(`${origin}/api/workspaces/leave`, { method: "POST" }),
        origin,
      )
    ).status,
  ).toBe(405);

  const { tenancy } = createFakeTenancyPersistence();
  const configured = createDashboardHandler(async () => new Response("html"), {
    authService: createFakeAuthService({ admitted: true }),
    tenancyPersistence: tenancy,
    authSecret: "test-auth-secret-minimum-32-chars-long",
  });
  expect(
    (await configured(new Request(`${origin}/api/workspaces/leave`), origin))
      .status,
  ).toBe(404);
  expect(
    (
      await configured(
        new Request(`${origin}/api/workspaces/leave`, { method: "HEAD" }),
        origin,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await configured(
        new Request(`${origin}/api/workspaces/leave`, { method: "POST" }),
        origin,
      )
    ).status,
  ).toBe(405);
});
