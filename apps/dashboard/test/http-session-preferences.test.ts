import type { AuthService } from "@holon/auth/server";
import type {
  AdmittedUser,
  SessionDeviceDto,
} from "@holon/contracts/dashboard";
import { PreferencesError, TenancyError } from "@holon/db/identity/server";
import { describe, expect, it, vi } from "vitest";

import { createDashboardHandler } from "../app/server/http-app.server.js";
import { issueSessionCsrfToken } from "../app/server/http-security.server.js";
const origin = "https://dashboard.example.invalid";
const secret = "synthetic-session-preferences-secret-at-least-32-chars";
const actor: AdmittedUser = {
  id: "user_a",
  name: "User A",
  sessionId: "session_a",
  expiresAt: "2030-01-08T00:00:00.000Z",
  githubAccountId: "github_1",
};
const devices: SessionDeviceDto[] = [
  {
    id: "session_a",
    createdAt: "2030-01-01T00:00:00.000Z",
    expiresAt: actor.expiresAt,
    isCurrent: true,
    label: "firefox",
  },
];
function fixture() {
  const refreshed = new Headers();
  refreshed.append("Set-Cookie", "native_refresh=1; HttpOnly; Secure");
  const auth = {
    appOrigin: origin,
    rateLimitStorage: {
      consume: vi.fn(async () => ({
        allowed: true,
        retryAfter: null as number | null,
      })),
    },
    handleAuthRequest: vi.fn(async () => new Response(null, { status: 404 })),
    getSession: vi.fn(async () => ({
      session: {
        user: { id: actor.id, name: actor.name },
        session: { id: actor.sessionId, expiresAt: actor.expiresAt },
      },
      headers: refreshed,
    })),
    getAdmittedUser: vi.fn<AuthService["getAdmittedUser"]>(async () => ({
      user: actor,
      status: "admitted",
      headers: refreshed,
    })),
    listSessions: vi.fn(async () => devices),
    revokeSession: vi.fn(async () => true),
    revokeAllSessions: vi.fn(async () => 2),
    clearSessionCookies: vi.fn(async () => [
      "native_session=; Max-Age=0; Secure; HttpOnly",
    ]),
    pruneExpiredCodes: vi.fn(async () => {}),
  } satisfies AuthService;
  const preferences = {
    readPreferences: vi.fn(async () => ({
      locale: "en" as const,
      timezone: "UTC",
    })),
    updatePreferences: vi.fn(
      async (
        _actor: AdmittedUser,
        input: { locale: "en" | "pt-BR"; timezone: string },
      ) => input,
    ),
  };
  const tenancy = {
    provisionPersonalWorkspace: vi.fn(),
    createTeamWorkspace: vi.fn(),
    createReauthIntent: vi.fn(),
    confirmReauthIntent: vi.fn(),
    readPendingReauthContext: vi.fn(async () => null),
    promoteMember: vi.fn(),
    demoteMember: vi.fn(),
    removeMember: vi.fn(),
    leaveWorkspace: vi.fn(),
    listUserWorkspaces: vi.fn(),
    readWorkspace: vi.fn(),
    readMembership: vi.fn(),
  };
  const services = {
    authService: auth,
    preferencesPersistence: preferences,
    tenancyPersistence: tenancy,
    authSecret: secret,
  };
  const handle = createDashboardHandler(
    async () => new Response("Synthetic render"),
    services,
  );
  const get = (path: string) => handle(new Request(origin + path), origin);
  async function post(path: string, body: unknown = {}, csrf?: string) {
    return handle(
      new Request(origin + path, {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          "X-CSRF-Token":
            csrf ?? (await issueSessionCsrfToken(actor.sessionId, secret)),
        },
        body: JSON.stringify(body),
      }),
      origin,
    );
  }
  return { auth, preferences, tenancy, services, refreshed, handle, get, post };
}
describe("device command HTTP projection", () => {
  it("lists coarse device DTOs and passes the current actor to revocation without client authority", async () => {
    const test = fixture();
    const list = await test.get("/api/auth/sessions?userId=foreign");
    expect(await list.json()).toEqual({ sessions: devices });
    expect(test.auth.listSessions).toHaveBeenCalledWith(
      actor.id,
      actor.sessionId,
    );
    const response = await test.post("/api/auth/sessions/session_other/revoke");
    expect(response.status).toBe(200);
    expect(test.auth.revokeSession).toHaveBeenCalledWith(
      actor,
      "session_other",
    );
    expect(test.auth.clearSessionCookies).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toEqual(
      test.refreshed.getSetCookie(),
    );
    expect(
      (
        await test.post("/api/auth/sessions/session_other/revoke", {
          userId: "foreign",
        })
      ).status,
    ).toBe(400);
    expect(
      (await test.post(`/api/auth/sessions/${"a".repeat(129)}/revoke`)).status,
    ).toBe(400);
    expect(
      (await test.post("/api/auth/sessions/session_other/revoke", {}, "wrong"))
        .status,
    ).toBe(403);
    expect(test.auth.revokeSession).toHaveBeenCalledTimes(1);
  });
  it("clears native cookies for current and global logout and preserves renewal cookies", async () => {
    const test = fixture();
    const current = await test.post(
      `/api/auth/sessions/${actor.sessionId}/revoke`,
    );
    expect(current.status).toBe(200);
    expect(current.headers.getSetCookie()).toHaveLength(2);
    const all = await test.post("/api/auth/sign-out/all");
    expect(all.status).toBe(200);
    expect(await all.json()).toEqual({ revokedCount: 2 });
    expect(all.headers.getSetCookie()).toHaveLength(2);
    expect(test.auth.revokeAllSessions).toHaveBeenCalledWith(actor);
    expect(test.auth.clearSessionCookies).toHaveBeenCalledTimes(2);
  });
  it("does not disclose malformed private device output", async () => {
    const test = fixture();
    test.auth.listSessions.mockResolvedValue([
      { ...devices[0], token: "private-token" },
    ] as unknown as SessionDeviceDto[]);
    const response = await test.get("/api/auth/sessions");
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-token");
  });
  it("denies a revoked actor at the write and never clears another device's cookies", async () => {
    const test = fixture();
    test.auth.revokeSession.mockRejectedValue(
      new TenancyError("user_not_admitted"),
    );
    const response = await test.post("/api/auth/sessions/session_other/revoke");
    expect(response.status).toBe(403);
    expect(test.auth.clearSessionCookies).not.toHaveBeenCalled();
  });
});

describe("governance HTTP composition", () => {
  const body = { targetUserId: "user_b", reauthIntentId: "reauth_a" };
  const cases = [
    [
      "promoteMember",
      "/api/workspaces/team_a/members/promote",
      body,
      { workspaceId: "team_a", userId: "user_b", role: "owner" },
    ],
    [
      "demoteMember",
      "/api/workspaces/team_a/members/demote",
      body,
      { workspaceId: "team_a", userId: "user_b", role: "member" },
    ],
    [
      "removeMember",
      "/api/workspaces/team_a/members/remove",
      body,
      { removed: true },
    ],
    [
      "leaveWorkspace",
      "/api/workspaces/team_a/leave",
      { reauthIntentId: "reauth_a" },
      { left: true },
    ],
  ] as const;
  it("validates and delegates reauth initialization with current actor and cookies", async () => {
    const test = fixture();
    const input = {
      workspaceId: "team_a",
      action: "promote",
      targetUserId: "user_b",
    };
    const receipt = {
      reauthIntentId: "reauth_a",
      expiresAt: "2030-01-01T00:10:00.000Z",
    };
    test.tenancy.createReauthIntent.mockResolvedValue(receipt);
    const result = await test.post("/api/auth/reauth/init", input);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(receipt);
    expect(test.tenancy.createReauthIntent).toHaveBeenCalledWith(actor, input);
    expect(result.headers.getSetCookie()).toEqual(
      test.refreshed.getSetCookie(),
    );
    expect(
      (
        await test.post("/api/auth/reauth/init", {
          ...input,
          actorId: "forged",
        })
      ).status,
    ).toBe(400);
    expect(
      (await test.post("/api/auth/reauth/init", input, "wrong")).status,
    ).toBe(403);
    expect(test.tenancy.createReauthIntent).toHaveBeenCalledTimes(1);
  });
  it.each(cases)(
    "%s fixes authority to the verified actor and explicit workspace",
    async (method, path, input, output) => {
      const test = fixture();
      test.tenancy[method].mockResolvedValue(output);
      const response = await test.post(path, input);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(output);
      expect(test.tenancy[method]).toHaveBeenCalledWith(actor, "team_a", input);
      expect(response.headers.getSetCookie()).toEqual(
        test.refreshed.getSetCookie(),
      );
      expect(
        (await test.post(path, { ...input, actorId: "forged" })).status,
      ).toBe(400);
      expect((await test.post(path, input, "wrong")).status).toBe(403);
      expect(
        (await test.post(path.replace("team_a", "x".repeat(129)), input))
          .status,
      ).toBe(400);
      expect(test.tenancy[method]).toHaveBeenCalledTimes(1);
    },
  );
  it.each(cases)(
    "%s fails closed without tenancy persistence",
    async (_method, path, input) => {
      const test = fixture();
      const handle = createDashboardHandler(
        async () => new Response("Synthetic render"),
        {
          authService: test.auth,
          authSecret: secret,
        },
      );
      const response = await handle(
        new Request(origin + path, {
          method: "POST",
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
            "X-CSRF-Token": await issueSessionCsrfToken(
              actor.sessionId,
              secret,
            ),
          },
          body: JSON.stringify(input),
        }),
        origin,
      );
      expect(response.status).toBe(503);
    },
  );
  it("init fails closed without persistence and a forged receipt is never exposed", async () => {
    const test = fixture();
    const input = {
      workspaceId: "team_a",
      action: "promote",
      targetUserId: "user_b",
    };
    const handle = createDashboardHandler(
      async () => new Response("Synthetic render"),
      {
        authService: test.auth,
        authSecret: secret,
      },
    );
    const response = await handle(
      new Request(origin + "/api/auth/reauth/init", {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          "X-CSRF-Token": await issueSessionCsrfToken(actor.sessionId, secret),
        },
        body: JSON.stringify(input),
      }),
      origin,
    );
    expect(response.status).toBe(503);
    test.tenancy.createReauthIntent.mockResolvedValue({
      reauthIntentId: "reauth_a",
      expiresAt: "invalid",
      secret: "synthetic-private",
    });
    const malformed = await test.post("/api/auth/reauth/init", input);
    expect(malformed.status).toBe(503);
    expect(await malformed.text()).not.toContain("synthetic-private");
  });
  it.each([
    ["governance_denied", 403, "denied"],
    ["reauth_required", 401, "reconnect_required"],
    ["member_not_found", 404, "invalid_request"],
    ["invalid_role_transition", 400, "invalid_request"],
    ["command_unknown", 503, "command_unknown"],
  ] as const)(
    "%s is a sanitized HTTP outcome",
    async (code, status, publicCode) => {
      const test = fixture();
      test.tenancy.promoteMember.mockRejectedValue(new TenancyError(code));
      const response = await test.post(
        "/api/workspaces/team_a/members/promote",
        body,
      );
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({
        error: { code: publicCode },
      });
      expect(response.headers.getSetCookie()).toEqual(
        test.refreshed.getSetCookie(),
      );
    },
  );
});
describe("personal preference HTTP boundary", () => {
  it("only passes the admitted actor, validates input and strict response DTOs", async () => {
    const test = fixture();
    const read = await test.get("/api/preferences?userId=foreign");
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({
      preferences: { locale: "en", timezone: "UTC" },
    });
    expect(test.preferences.readPreferences).toHaveBeenCalledWith(actor);
    const value = { locale: "pt-BR", timezone: "America/Sao_Paulo" };
    const save = await test.post("/api/preferences", value);
    expect(save.status).toBe(200);
    expect(await save.json()).toEqual({ preferences: value });
    expect(test.preferences.updatePreferences).toHaveBeenCalledWith(
      actor,
      value,
    );
    for (const input of [
      { ...value, userId: "foreign" },
      { ...value, timezone: "+02:00" },
      { ...value, locale: "fr" },
    ])
      expect((await test.post("/api/preferences", input)).status).toBe(400);
    expect((await test.post("/api/preferences", value, "wrong")).status).toBe(
      403,
    );
    expect(test.preferences.updatePreferences).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["invalid_preferences", 400, "invalid_request"],
    ["user_not_admitted", 403, "denied"],
    ["command_unknown", 503, "command_unknown"],
    ["storage_unavailable", 503, "unavailable"],
    ["storage_corrupted", 503, "unavailable"],
  ] as const)(
    "maps %s safely with all session cookies",
    async (code, status, publicCode) => {
      const test = fixture();
      test.preferences.updatePreferences.mockRejectedValue(
        new PreferencesError(code),
      );
      const response = await test.post("/api/preferences", {
        locale: "en",
        timezone: "UTC",
      });
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({
        error: { code: publicCode },
      });
      expect(response.headers.getSetCookie()).toEqual(
        test.refreshed.getSetCookie(),
      );
    },
  );
  it("fails closed when persistence is missing", async () => {
    const test = fixture();
    const handle = createDashboardHandler(
      async () => new Response("Synthetic render"),
      {
        authService: test.auth,
        tenancyPersistence: test.services.tenancyPersistence,
        authSecret: secret,
      },
    );
    expect(
      (await handle(new Request(`${origin}/api/preferences`), origin)).status,
    ).toBe(503);
    const request = new Request(`${origin}/api/preferences`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-CSRF-Token": await issueSessionCsrfToken(actor.sessionId, secret),
      },
      body: JSON.stringify({ locale: "en", timezone: "UTC" }),
    });
    expect((await handle(request, origin)).status).toBe(503);
  });
  it("disconnected identity cannot read or mutate preferences", async () => {
    const test = fixture();
    test.auth.getAdmittedUser.mockResolvedValue({
      user: null,
      status: "disconnected",
      headers: test.refreshed,
    });
    expect((await test.get("/api/preferences")).status).toBe(401);
    expect(
      (await test.post("/api/preferences", { locale: "en", timezone: "UTC" }))
        .status,
    ).toBe(401);
    expect(test.preferences.readPreferences).not.toHaveBeenCalled();
    expect(test.preferences.updatePreferences).not.toHaveBeenCalled();
  });
});
