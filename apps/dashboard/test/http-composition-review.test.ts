import type { AuthService } from "@holon/auth/server";
import type { AdmittedUser } from "@holon/contracts/dashboard";
import type { TenancyPersistence } from "@holon/db/identity/server";
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
    handleAuthRequest: vi.fn(async () => Response.json(null)),
    getSession: vi.fn(async () => ({
      session: {
        user: { id: user.id, name: user.name },
        session: { id: user.sessionId, expiresAt: user.expiresAt },
      },
      headers: refreshed,
    })),
    getAdmittedUser: vi.fn(async () => ({ user, headers: refreshed })),
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
    expect(
      test.tenancyPersistence.provisionPersonalWorkspace,
    ).not.toHaveBeenCalled();
  },
);
