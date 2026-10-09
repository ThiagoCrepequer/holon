import type { AuthService } from "@holon/auth/server";
import { CollaborationError } from "@holon/db/identity/server";
import { expect, it, vi } from "vitest";

import { createDashboardHandler } from "../app/server/http-app.server.js";
import { issueSessionCsrfToken } from "../app/server/http-security.server.js";
const origin = "https://dashboard.example.invalid";
const secret = "synthetic-collaboration-secret-at-least-32-chars";
const actor = {
  id: "actor",
  name: "Synthetic",
  sessionId: "session",
  githubAccountId: "101",
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const invitation = {
  id: "invite",
  workspaceId: "team",
  state: "pending" as const,
  expiresAt: "2099-01-01T00:00:00.000Z",
  recipientEmail: "target@example.invalid",
  delivery: "intent_recorded" as const,
};
const connection = {
  installationId: 77,
  state: "active" as const,
  generation: 1,
};
function setup() {
  const auth = {
    appOrigin: origin,
    rateLimitStorage: {
      consume: vi.fn(async () => ({ allowed: true, retryAfter: null })),
    },
    getAdmittedUser: vi.fn<AuthService["getAdmittedUser"]>(async () => ({
      user: actor,
      status: "admitted",
      headers: new Headers({ "Set-Cookie": "synthetic=refreshed" }),
    })),
    handleAuthRequest: vi.fn(),
    getSession: vi.fn(),
    listSessions: vi.fn(),
    revokeSession: vi.fn(),
    revokeAllSessions: vi.fn(),
    clearSessionCookies: vi.fn(),
    pruneExpiredCodes: vi.fn(),
  } satisfies AuthService;
  const tenancy = {
    provisionPersonalWorkspace: vi.fn(),
    createTeamWorkspace: vi.fn(),
    listUserWorkspaces: vi.fn(),
    readWorkspace: vi.fn(),
    readMembership: vi.fn(),
    createReauthIntent: vi.fn(),
    confirmReauthIntent: vi.fn(),
    readPendingReauthContext: vi.fn(),
    promoteMember: vi.fn(),
    demoteMember: vi.fn(),
    removeMember: vi.fn(),
    leaveWorkspace: vi.fn(),
  };
  const collaboration = {
    createInvitation: vi.fn(async () => invitation),
    listInvitations: vi.fn(async () => [invitation]),
    acceptInvitation: vi.fn(async () => ({
      status: "accepted" as const,
      membershipActive: true,
    })),
    cancelInvitation: vi.fn(async () => ({
      ...invitation,
      state: "canceled" as const,
    })),
    listConnections: vi.fn(async () => [connection]),
    linkInstallation: vi.fn(async () => connection),
    unlinkInstallation: vi.fn(async () => ({ unlinked: true as const })),
    authorizeReviews: vi.fn(async () => ({
      userId: "actor",
      workspaceId: "team",
      repositories: [{ installationId: 77, repositoryId: 91 }],
    })),
    connectionStatus: vi.fn(async () => ({ status: "connected" as const })),
    createConnectionReauth: vi.fn(async () => ({
      reauthIntentId: "proof",
      expiresAt: "2099-01-01T00:00:00.000Z",
    })),
  };
  const services = {
    authService: auth,
    tenancyPersistence: tenancy,
    collaboration,
    authSecret: secret,
  };
  const handle = createDashboardHandler(
    async () => new Response("generic"),
    services,
  );
  async function request(path: string, body?: unknown, headers?: HeadersInit) {
    const requestHeaders = new Headers();
    if (body !== undefined) {
      requestHeaders.set("Origin", origin);
      requestHeaders.set("Content-Type", "application/json");
      requestHeaders.set(
        "X-CSRF-Token",
        await issueSessionCsrfToken(actor.sessionId, secret),
      );
    }
    for (const [name, value] of new Headers(headers))
      requestHeaders.set(name, value);
    return handle(
      new Request(origin + path, {
        method: body === undefined ? "GET" : "POST",
        headers: requestHeaders,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      origin,
    );
  }

  return { auth, collaboration, services, handle, request };
}
it("all collaboration APIs enforce the same admission, CSRF and DTOs", async () => {
  const f = setup();
  const cases: [string, unknown, unknown][] = [
    [
      "/api/github/reauth",
      { workspaceId: "team", installationId: 77, action: "link" },
      { reauthIntentId: "proof", expiresAt: "2099-01-01T00:00:00.000Z" },
    ],
    [
      "/api/workspaces/team/github/link",
      { installationId: 77, reauthIntentId: "proof" },
      connection,
    ],
    [
      "/api/workspaces/team/github/unlink",
      { installationId: 77, reauthIntentId: "proof" },
      { unlinked: true },
    ],
    [
      "/api/workspaces/team/invitations",
      { operationId: "op", email: "target@example.invalid", locale: "en" },
      invitation,
    ],
    [
      "/api/invitations/invite/accept",
      {},
      { status: "accepted", membershipActive: true },
    ],
    [
      "/api/workspaces/team/invitations/invite/cancel",
      {},
      { ...invitation, state: "canceled" },
    ],
  ];
  for (const [path, body, expected] of cases) {
    const response = await f.request(path, body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
    expect(response.headers.get("Set-Cookie")).toContain("synthetic=refreshed");
  }
  for (const [path, expected] of [
    ["/api/github/status", { status: "connected" }],
    ["/api/workspaces/team/github", [connection]],
    ["/api/workspaces/team/invitations", [invitation]],
    [
      "/api/workspaces/team/github/repositories",
      { repositories: [{ installationId: 77, repositoryId: 91 }] },
    ],
  ] as const) {
    const response = await f.request(path);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
  }
});
it.each(["GET", "HEAD"])(
  "%s invitation scanner is generic and has zero mutations or identity/provider reads",
  async (method) => {
    const f = setup();
    for (const id of ["invite", "unknown"]) {
      const response = await f.handle(
        new Request(origin + "/api/invitations/" + id, { method }),
        origin,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      if (method === "GET")
        expect(await response.json()).toEqual({
          status: "authentication_required",
        });
    }
    expect(f.auth.getAdmittedUser).not.toHaveBeenCalled();
    expect(f.collaboration.acceptInvitation).not.toHaveBeenCalled();
  },
);
it("CSRF, extra fields, anonymous and unconfigured capabilities deny without mutation", async () => {
  const f = setup();
  expect(
    (
      await f.request(
        "/api/invitations/invite/accept",
        {},
        { "X-CSRF-Token": "wrong" },
      )
    ).status,
  ).toBe(403);
  expect(
    (await f.request("/api/invitations/invite/accept", { role: "owner" }))
      .status,
  ).toBe(400);
  f.auth.getAdmittedUser.mockResolvedValue({
    user: null,
    status: "anonymous",
    headers: new Headers(),
  });
  expect((await f.request("/api/invitations/invite/accept", {})).status).toBe(
    403,
  );
  expect(f.collaboration.acceptInvitation).not.toHaveBeenCalled();
  const handle = createDashboardHandler(async () => new Response(), {
    ...f.services,
    collaboration: undefined,
  });
  f.auth.getAdmittedUser.mockResolvedValue({
    user: actor,
    status: "admitted",
    headers: new Headers(),
  });
  expect(
    (await handle(new Request(origin + "/api/github/status"), origin)).status,
  ).toBe(503);
});
it.each([
  ["denied", 403],
  ["reconnect_required", 401],
  ["unavailable", 503],
  ["command_unknown", 503],
  ["conflict", 409],
  ["rate_limited", 429],
] as const)("error %s maps to safe status %i", async (code, status) => {
  const f = setup();
  f.collaboration.acceptInvitation.mockRejectedValue(
    new CollaborationError(code),
  );
  const response = await f.request("/api/invitations/invite/accept", {});
  expect(response.status).toBe(status);
  expect(JSON.stringify(await response.json())).not.toContain(
    "target@example.invalid",
  );
  if (code === "rate_limited")
    expect(response.headers.get("Retry-After")).toBe("60");
});
