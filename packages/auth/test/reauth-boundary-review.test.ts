import {
  reauthReceiptSchema,
  workspaceMembershipDtoSchema,
} from "@holon/contracts/dashboard";
import { createTenancyPersistence } from "@holon/db/identity/server";
import { env, reset } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";

import { createDashboardHandler } from "../../../apps/dashboard/app/server/http-app.server.js";
import { fakeGitHub } from "./review-provider.js";
import {
  beginOAuth,
  completeOAuth,
  setupAuthService,
  testOrigin,
  testSecret,
  type CookieJar,
} from "./support.js";

const database = (env as { AUTH_DB: D1Database }).AUTH_DB;
afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});
async function fixture(nativeDatabase = database) {
  const auth = await setupAuthService({ database: nativeDatabase });
  const tenancy = createTenancyPersistence(database);
  const handle = createDashboardHandler(
    async () => new Response("Synthetic render"),
    { authService: auth, tenancyPersistence: tenancy, authSecret: testSecret },
  );
  const github = fakeGitHub();
  async function signIn(
    code: string,
    id: number,
    email = `reauth-${id}@example.invalid`,
  ) {
    const flow = await beginOAuth(auth);
    github.authorize(code, { id, email }, flow.authorizationURL);
    expect((await completeOAuth(auth, flow, code)).status).toBe(302);
    const actor = (
      await auth.getAdmittedUser(
        new Request(`${testOrigin}/api/auth/session`, {
          headers: flow.jar.headers(),
        }),
      )
    ).user;
    expect(actor).not.toBeNull();
    if (!actor) throw new Error("Synthetic admission failed");
    return { jar: flow.jar, actor };
  }
  const owner = await signIn("review-owner", 6101);
  const member = await signIn("review-member", 6102);
  const team = await tenancy.createTeamWorkspace(owner.actor, {
    name: "Review team",
    operationId: "reauth_team_create",
  });
  await database
    .prepare(
      "INSERT INTO membership (workspace_id,user_id,role,created_at,updated_at) VALUES (?,?,'member',0,0)",
    )
    .bind(team.workspace.id, member.actor.id)
    .run();
  async function command(jar: CookieJar, path: string, body: unknown) {
    const sessionResponse = await handle(
      new Request(`${testOrigin}/api/auth/session`, { headers: jar.headers() }),
      testOrigin,
    );
    jar.capture(sessionResponse);
    const headers = jar.headers();
    headers.set("Origin", testOrigin);
    headers.set("Content-Type", "application/json");
    headers.set(
      "X-CSRF-Token",
      sessionResponse.headers.get("X-CSRF-Token") ?? "",
    );
    return handle(
      new Request(testOrigin + path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
      testOrigin,
    );
  }
  async function intent(
    action: "promote" | "demote" | "remove" | "leave" = "promote",
    targetUserId = member.actor.id,
    workspaceId = team.workspace.id,
  ) {
    const response = await command(owner.jar, "/api/auth/reauth/init", {
      workspaceId,
      action,
      targetUserId,
    });
    expect(response.status).toBe(200);
    return reauthReceiptSchema.parse(await response.json());
  }
  async function reauthenticate(
    receipt: Awaited<ReturnType<typeof intent>>,
    id = 6101,
    email = "reauth-6101@example.invalid",
    beforeCallback?: () => Promise<unknown>,
  ) {
    const headers = owner.jar.headers();
    headers.set("Origin", testOrigin);
    headers.set("Content-Type", "application/json");
    const response = await handle(
      new Request(`${testOrigin}/api/auth/sign-in/social`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          provider: "github",
          callbackURL: "/signed-in",
          disableRedirect: true,
          reauthIntentId: receipt.reauthIntentId,
        }),
      }),
      testOrigin,
    );
    expect(response.status).toBe(200);
    owner.jar.capture(response);
    const payload = (await response.json()) as { url: string };
    const authorizationURL = new URL(payload.url);
    const state = authorizationURL.searchParams.get("state");
    expect(state).toBeTruthy();
    if (!state) throw new Error("Missing native OAuth state");
    const code = `review-reauth-${receipt.reauthIntentId}`;
    github.authorize(code, { id, email }, authorizationURL);
    const flow = {
      jar: owner.jar,
      state,
      authorizationURL,
      initialHeaders: owner.jar.headers(),
    };
    await beforeCallback?.();
    return completeOAuth(auth, flow, code);
  }
  async function role() {
    return database
      .prepare("SELECT role FROM membership WHERE workspace_id=? AND user_id=?")
      .bind(team.workspace.id, member.actor.id)
      .first("role");
  }
  return {
    auth,
    tenancy,
    handle,
    github,
    owner,
    member,
    team,
    command,
    intent,
    reauthenticate,
    role,
    signIn,
  };
}

it("native reauth authorizes only the newly issued session and consumes proof without recreating a removed member", async () => {
  const f = await fixture();
  const receipt = await f.intent();
  const originalJarHeaders = f.owner.jar.headers();
  const callback = await f.reauthenticate(receipt);
  expect(callback.status).toBe(302);
  expect(callback.headers.get("Location")).toBe(`${testOrigin}/signed-in`);
  const proofActor = (
    await f.auth.getAdmittedUser(
      new Request(`${testOrigin}/api/auth/session`, {
        headers: f.owner.jar.headers(),
      }),
    )
  ).user;
  expect(proofActor?.sessionId).not.toBe(f.owner.actor.sessionId);
  await expect(
    f.tenancy.promoteMember(f.owner.actor, f.team.workspace.id, {
      targetUserId: f.member.actor.id,
      reauthIntentId: receipt.reauthIntentId,
    }),
  ).rejects.toMatchObject({ code: "reauth_required" });
  expect(await f.role()).toBe("member");
  const response = await f.command(
    f.owner.jar,
    `/api/workspaces/${f.team.workspace.id}/members/promote`,
    { targetUserId: f.member.actor.id, reauthIntentId: receipt.reauthIntentId },
  );
  expect(response.status).toBe(200);
  workspaceMembershipDtoSchema.parse(await response.json());
  expect(await f.role()).toBe("owner");
  expect(
    (
      await f.auth.getAdmittedUser(
        new Request(`${testOrigin}/api/auth/session`, {
          headers: originalJarHeaders,
        }),
      )
    ).user?.sessionId,
  ).toBe(f.owner.actor.sessionId);
  await database
    .prepare("DELETE FROM membership WHERE workspace_id=? AND user_id=?")
    .bind(f.team.workspace.id, f.member.actor.id)
    .run();
  const replay = await f.command(
    f.owner.jar,
    `/api/workspaces/${f.team.workspace.id}/members/promote`,
    { targetUserId: f.member.actor.id, reauthIntentId: receipt.reauthIntentId },
  );
  expect([403, 404, 409]).toContain(replay.status);
  expect(await f.role()).toBeNull();
});

it("a different actual GitHub subject cannot prove reauth even with the same verified email", async () => {
  const f = await fixture();
  const receipt = await f.intent();
  const response = await f.reauthenticate(
    receipt,
    6199,
    "reauth-6101@example.invalid",
  );
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toContain("error");
  expect(
    await database
      .prepare("SELECT confirmed_at,consumed_at FROM reauth_intent WHERE id=?")
      .bind(receipt.reauthIntentId)
      .first(),
  ).toEqual({ confirmed_at: null, consumed_at: null });
  expect(
    await database
      .prepare(
        "SELECT COUNT(*) FROM account WHERE providerId='github' AND accountId='6199'",
      )
      .first("COUNT(*)"),
  ).toBe(0);
  expect(await f.role()).toBe("member");
});

for (const caller of ["anonymous", "other-user"] as const) {
  it(`a ${caller} caller cannot start OAuth using another session's reauth intent`, async () => {
    const f = await fixture();
    const receipt = await f.intent();
    const headers =
      caller === "other-user" ? f.member.jar.headers() : new Headers();
    headers.set("Origin", testOrigin);
    headers.set("Content-Type", "application/json");
    const response = await f.handle(
      new Request(`${testOrigin}/api/auth/sign-in/social`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          provider: "github",
          callbackURL: "/signed-in",
          disableRedirect: true,
          reauthIntentId: receipt.reauthIntentId,
        }),
      }),
      testOrigin,
    );
    expect([400, 401, 403]).toContain(response.status);
    expect(await f.role()).toBe("member");
    expect(
      await database
        .prepare(
          "SELECT confirmed_at,consumed_at FROM reauth_intent WHERE id=?",
        )
        .bind(receipt.reauthIntentId)
        .first(),
    ).toEqual({ confirmed_at: null, consumed_at: null });
  });
}

it("revoking the original session during OAuth prevents reauth confirmation and successful redirect", async () => {
  const f = await fixture();
  const receipt = await f.intent();
  const response = await f.reauthenticate(
    receipt,
    6101,
    "reauth-6101@example.invalid",
    () =>
      database
        .prepare("DELETE FROM session WHERE id=?")
        .bind(f.owner.actor.sessionId)
        .run(),
  );
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toContain("error");
  expect(
    await database
      .prepare("SELECT confirmed_at,consumed_at FROM reauth_intent WHERE id=?")
      .bind(receipt.reauthIntentId)
      .first(),
  ).toEqual({ confirmed_at: null, consumed_at: null });
  expect(await f.role()).toBe("member");
});

it("native OAuth proofs drive HTTP demotion and removal, then removed membership loses reads and commands", async () => {
  const f = await fixture();
  async function authorized(action: "promote" | "demote" | "remove") {
    const receipt = await f.intent(action);
    expect((await f.reauthenticate(receipt)).headers.get("Location")).toBe(
      `${testOrigin}/signed-in`,
    );
    const result = await f.command(
      f.owner.jar,
      `/api/workspaces/${f.team.workspace.id}/members/${action}`,
      {
        targetUserId: f.member.actor.id,
        reauthIntentId: receipt.reauthIntentId,
      },
    );
    expect(result.status).toBe(200);
    expect(
      await database
        .prepare("SELECT consumed_at FROM reauth_intent WHERE id=?")
        .bind(receipt.reauthIntentId)
        .first("consumed_at"),
    ).not.toBeNull();
    return result;
  }
  workspaceMembershipDtoSchema.parse(
    await (await authorized("promote")).json(),
  );
  expect(await f.role()).toBe("owner");
  workspaceMembershipDtoSchema.parse(await (await authorized("demote")).json());
  expect(await f.role()).toBe("member");
  expect(await (await authorized("remove")).json()).toEqual({ removed: true });
  expect(await f.role()).toBeNull();
  expect(await f.tenancy.listUserWorkspaces(f.member.actor.id)).toEqual([]);
  expect(
    await f.tenancy.readWorkspace(f.member.actor.id, f.team.workspace.id),
  ).toBeNull();
  expect(
    await f.tenancy.readMembership(f.member.actor.id, f.team.workspace.id),
  ).toBeNull();
  const denied = await f.command(f.member.jar, "/api/auth/reauth/init", {
    workspaceId: f.team.workspace.id,
    action: "leave",
    targetUserId: f.member.actor.id,
  });
  expect([403, 404]).toContain(denied.status);
});

it("an owner can leave through a native proof while the other owner remains", async () => {
  const f = await fixture();
  const promote = await f.intent();
  await f.reauthenticate(promote);
  expect(
    (
      await f.command(
        f.owner.jar,
        `/api/workspaces/${f.team.workspace.id}/members/promote`,
        {
          targetUserId: f.member.actor.id,
          reauthIntentId: promote.reauthIntentId,
        },
      )
    ).status,
  ).toBe(200);
  const leave = await f.intent("leave", f.owner.actor.id);
  expect((await f.reauthenticate(leave)).headers.get("Location")).toBe(
    `${testOrigin}/signed-in`,
  );
  const result = await f.command(
    f.owner.jar,
    `/api/workspaces/${f.team.workspace.id}/leave`,
    { reauthIntentId: leave.reauthIntentId },
  );
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ left: true });
  expect(await f.role()).toBe("owner");
  expect(await f.tenancy.listUserWorkspaces(f.owner.actor.id)).toEqual([]);
});

it("revocation at the confirmation write rejects the issued proof and clears its native session", async () => {
  let originalSessionId = "";
  let intercepted = false;
  const interleaved = new Proxy(database, {
    get(target, property) {
      if (property === "prepare")
        return (sql: string) => {
          const statement = target.prepare(sql);
          if (!/UPDATE\s+reauth_intent\s+SET\s+confirmed_at/iu.test(sql))
            return statement;
          function wrap(prepared: D1PreparedStatement): D1PreparedStatement {
            return new Proxy(prepared, {
              get(inner, key) {
                if (key === "bind")
                  return (...values: unknown[]) => wrap(inner.bind(...values));
                if (key === "run")
                  return async () => {
                    intercepted = true;
                    await database
                      .prepare("DELETE FROM session WHERE id=?")
                      .bind(originalSessionId)
                      .run();
                    return inner.run();
                  };
                const value = Reflect.get(inner, key);
                return typeof value === "function" ? value.bind(inner) : value;
              },
            });
          }
          return wrap(statement);
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const f = await fixture(interleaved);
  originalSessionId = f.owner.actor.sessionId;
  const receipt = await f.intent();
  const response = await f.reauthenticate(receipt);
  expect(intercepted).toBe(true);
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toContain("error");
  expect(
    (
      await f.auth.getAdmittedUser(
        new Request(`${testOrigin}/api/auth/session`, {
          headers: f.owner.jar.headers(),
        }),
      )
    ).user,
  ).toBeNull();
  expect(
    await database
      .prepare("SELECT COUNT(*) FROM session WHERE userId=?")
      .bind(f.owner.actor.id)
      .first("COUNT(*)"),
  ).toBe(0);
  expect(
    await database
      .prepare("SELECT confirmed_at,consumed_at FROM reauth_intent WHERE id=?")
      .bind(receipt.reauthIntentId)
      .first(),
  ).toEqual({ confirmed_at: null, consumed_at: null });
  expect(await f.role()).toBe("member");
});

for (const committed of [false, true]) {
  it(`confirmation storage failure after commit=${committed} cannot leave the newly issued session`, async () => {
    const failing = new Proxy(database, {
      get(target, property) {
        if (property === "prepare")
          return (sql: string) => {
            const statement = target.prepare(sql);
            if (!/UPDATE\s+reauth_intent\s+SET\s+confirmed_at/iu.test(sql))
              return statement;
            function wrap(prepared: D1PreparedStatement): D1PreparedStatement {
              return new Proxy(prepared, {
                get(inner, key) {
                  if (key === "bind")
                    return (...values: unknown[]) =>
                      wrap(inner.bind(...values));
                  if (key === "run")
                    return async () => {
                      if (committed) await inner.run();
                      throw new Error(
                        "Synthetic confirmation result unavailable",
                      );
                    };
                  const value = Reflect.get(inner, key);
                  return typeof value === "function"
                    ? value.bind(inner)
                    : value;
                },
              });
            }
            return wrap(statement);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const f = await fixture(failing);
    const receipt = await f.intent();
    const originalHeaders = f.owner.jar.headers();
    const response = await f.reauthenticate(receipt).catch(() => null);
    if (response?.status === 302)
      expect(response.headers.get("Location")).toContain("error");
    else expect(response?.status ?? 503).toBeGreaterThanOrEqual(400);
    expect(
      await database
        .prepare("SELECT COUNT(*) FROM session WHERE userId=?")
        .bind(f.owner.actor.id)
        .first("COUNT(*)"),
    ).toBe(1);
    expect(
      (
        await f.auth.getAdmittedUser(
          new Request(`${testOrigin}/api/auth/session`, {
            headers: originalHeaders,
          }),
        )
      ).user?.sessionId,
    ).toBe(f.owner.actor.sessionId);
    expect(
      (
        await f.auth.getAdmittedUser(
          new Request(`${testOrigin}/api/auth/session`, {
            headers: f.owner.jar.headers(),
          }),
        )
      ).user,
    ).toBeNull();
    const stored = await database
      .prepare("SELECT confirmed_at,consumed_at FROM reauth_intent WHERE id=?")
      .bind(receipt.reauthIntentId)
      .first<{ confirmed_at: number | null; consumed_at: number | null }>();
    expect(stored?.confirmed_at !== null).toBe(committed);
    expect(stored?.consumed_at).toBeNull();
    expect(await f.role()).toBe("member");
  });
}

it("ownership of another team cannot authorize a local member or an outsider", async () => {
  const f = await fixture();
  const outsider = await f.signIn("review-outsider", 6130);
  await f.tenancy.createTeamWorkspace(f.member.actor, {
    name: "Member's other team",
    operationId: "other_member_team",
  });
  await f.tenancy.createTeamWorkspace(outsider.actor, {
    name: "Outsider team",
    operationId: "outsider_team",
  });
  for (const caller of [f.member, outsider]) {
    const init = await f.command(caller.jar, "/api/auth/reauth/init", {
      workspaceId: f.team.workspace.id,
      action: "promote",
      targetUserId: f.member.actor.id,
    });
    expect(init.status).toBe(403);
    for (const action of ["promote", "remove"]) {
      const result = await f.command(
        caller.jar,
        `/api/workspaces/${f.team.workspace.id}/members/${action}`,
        {
          targetUserId: f.member.actor.id,
          reauthIntentId: "reauth_unavailable",
        },
      );
      expect(result.status).toBe(403);
    }
  }
  expect(await f.role()).toBe("member");
  expect(
    await database
      .prepare("SELECT COUNT(*) FROM reauth_intent")
      .first("COUNT(*)"),
  ).toBe(0);
});

it("a native proof cannot be redirected to another existing member and remains usable for its intended target", async () => {
  const f = await fixture();
  const other = await f.signIn("review-other-target", 6131);
  await database
    .prepare(
      "INSERT INTO membership (workspace_id,user_id,role,created_at,updated_at) VALUES (?,?,'member',0,0)",
    )
    .bind(f.team.workspace.id, other.actor.id)
    .run();
  const receipt = await f.intent();
  expect((await f.reauthenticate(receipt)).headers.get("Location")).toBe(
    `${testOrigin}/signed-in`,
  );
  const wrong = await f.command(
    f.owner.jar,
    `/api/workspaces/${f.team.workspace.id}/members/promote`,
    {
      targetUserId: other.actor.id,
      reauthIntentId: receipt.reauthIntentId,
    },
  );
  expect(wrong.status).toBe(403);
  expect(
    await database
      .prepare("SELECT role FROM membership WHERE workspace_id=? AND user_id=?")
      .bind(f.team.workspace.id, other.actor.id)
      .first("role"),
  ).toBe("member");
  expect(await f.role()).toBe("member");
  expect(
    await database
      .prepare("SELECT consumed_at FROM reauth_intent WHERE id=?")
      .bind(receipt.reauthIntentId)
      .first("consumed_at"),
  ).toBeNull();
  expect(
    (
      await f.command(
        f.owner.jar,
        `/api/workspaces/${f.team.workspace.id}/members/promote`,
        {
          targetUserId: f.member.actor.id,
          reauthIntentId: receipt.reauthIntentId,
        },
      )
    ).status,
  ).toBe(200);
  expect(await f.role()).toBe("owner");
});
