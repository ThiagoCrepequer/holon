import { createTenancyPersistence } from "@holon/db/identity/server";
import {
  applyD1Migrations,
  env,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";

import { createDashboardHandler } from "../../../apps/dashboard/app/server/http-app.server.js";
import { createAuthService } from "../src/server.js";
import {
  CookieJar,
  fakeGitHub,
  type GitHubIdentity,
} from "./review-provider.js";

const origin = "https://localhost";
const secret = "synthetic-http-native-secret-only-for-tests-0001";
const bindings = env as { AUTH_DB: D1Database; AUTH_MIGRATIONS: D1Migration[] };

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

it("real native OAuth and D1 enforce personal idempotence, actor isolation and current membership through HTTP", async () => {
  await applyD1Migrations(bindings.AUTH_DB, bindings.AUTH_MIGRATIONS);
  const authService = createAuthService({
    database: bindings.AUTH_DB,
    appOrigin: origin,
    authSecret: secret,
    githubClientId: "synthetic-client-id",
    githubClientSecret: "synthetic-client-secret",
    environment: "development",
  });
  const handle = createDashboardHandler(
    async () => new Response("Synthetic render"),
    {
      authService,
      tenancyPersistence: createTenancyPersistence(bindings.AUTH_DB),
      authSecret: secret,
    },
  );
  const provider = fakeGitHub();

  async function signIn(code: string, identity: GitHubIdentity) {
    const jar = new CookieJar();
    const started = await handle(
      new Request(`${origin}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "github",
          callbackURL: `${origin}/app`,
          disableRedirect: true,
        }),
      }),
      origin,
    );
    expect(started.status).toBe(200);
    jar.capture(started);
    const authorizationURL = new URL(
      (await started.json<{ url: string }>()).url,
    );
    provider.authorize(code, identity, authorizationURL);
    const callback = new URL(`${origin}/api/auth/callback/github`);
    callback.searchParams.set(
      "state",
      authorizationURL.searchParams.get("state")!,
    );
    callback.searchParams.set("code", code);
    const completed = await handle(
      new Request(callback, { headers: jar.headers() }),
      origin,
    );
    expect(completed.status).toBe(302);
    jar.capture(completed);
    expect(jar.hasSession()).toBe(true);
    const session = await handle(
      new Request(`${origin}/api/auth/session`, { headers: jar.headers() }),
      origin,
    );
    expect(session.status).toBe(200);
    jar.capture(session);
    const csrfToken = session.headers.get("X-CSRF-Token");
    expect(csrfToken).toMatch(/^[0-9a-f]{64}$/u);
    const userId = (await session.json<{ user: { id: string } }>()).user.id;
    return { jar, csrfToken: csrfToken!, userId };
  }

  function command(
    actor: Awaited<ReturnType<typeof signIn>>,
    path: string,
    body: unknown,
    csrf = actor.csrfToken,
  ) {
    const headers = actor.jar.headers();
    headers.set("Origin", origin);
    headers.set("Content-Type", "application/json");
    headers.set("X-CSRF-Token", csrf);
    headers.set("Sec-Fetch-Site", "same-origin");
    return handle(
      new Request(`${origin}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
      origin,
    );
  }

  const actorA = await signIn("native_http_a", {
    id: 92001,
    email: "native-http-a@example.invalid",
  });
  const actorB = await signIn("native_http_b", {
    id: 92002,
    email: "native-http-b@example.invalid",
  });
  const personal = await Promise.all([
    command(actorA, "/api/workspaces/personal", {}),
    command(actorA, "/api/workspaces/personal", {}),
  ]);
  expect(personal.map((response) => response.status)).toEqual([200, 200]);
  expect(
    (
      await bindings.AUTH_DB.prepare(
        "SELECT id FROM workspace WHERE type='personal' AND personal_user_id=?",
      )
        .bind(actorA.userId)
        .all()
    ).results,
  ).toHaveLength(1);
  expect(
    (
      await bindings.AUTH_DB.prepare(
        "SELECT workspace_id,user_id,role FROM membership",
      ).all()
    ).results,
  ).toHaveLength(1);

  const teamPayload = {
    name: "Native scoped team",
    operationId: "native_http_team_operation",
  };
  const team = await command(actorA, "/api/workspaces/team", teamPayload);
  expect(team.status).toBe(200);
  const created = (await team.json()) as {
    workspace: { id: string };
    membership: { userId: string; role: string };
  };
  expect(created.membership).toMatchObject({
    userId: actorA.userId,
    role: "owner",
  });
  const replay = await command(actorA, "/api/workspaces/team", teamPayload);
  expect(replay.status).toBe(200);
  expect(
    (await replay.json<{ workspace: { id: string } }>()).workspace.id,
  ).toBe(created.workspace.id);
  expect(
    (await bindings.AUTH_DB.prepare("SELECT id FROM workspace").all()).results,
  ).toHaveLength(2);
  expect(
    (
      await bindings.AUTH_DB.prepare(
        "SELECT operation_id FROM tenancy_operation",
      ).all()
    ).results,
  ).toHaveLength(1);

  const foreign = await handle(
    new Request(`${origin}/api/workspaces/${created.workspace.id}`, {
      headers: actorB.jar.headers(),
    }),
    origin,
  );
  expect(foreign.status).toBe(404);
  const forged = await command(actorB, "/api/workspaces/team", {
    ...teamPayload,
    operationId: "native_forged_actor",
    actorUserId: actorA.userId,
  });
  expect(forged.status).toBe(400);
  const wrongSessionCsrf = await command(
    actorB,
    "/api/workspaces/team",
    { name: "Denied team", operationId: "native_wrong_csrf" },
    actorA.csrfToken,
  );
  expect(wrongSessionCsrf.status).toBe(403);
  expect(
    (await bindings.AUTH_DB.prepare("SELECT id FROM workspace").all()).results,
  ).toHaveLength(2);

  await bindings.AUTH_DB.prepare(
    "INSERT INTO membership (workspace_id,user_id,role,created_at,updated_at) VALUES (?,?,'member',0,0)",
  )
    .bind(created.workspace.id, actorB.userId)
    .run();
  const memberRead = await handle(
    new Request(`${origin}/api/workspaces/${created.workspace.id}`, {
      headers: actorB.jar.headers(),
    }),
    origin,
  );
  expect(memberRead.status).toBe(200);
  expect((await memberRead.json<{ role: string }>()).role).toBe("member");
  await bindings.AUTH_DB.prepare(
    "DELETE FROM membership WHERE workspace_id=? AND user_id=?",
  )
    .bind(created.workspace.id, actorB.userId)
    .run();
  const removed = await handle(
    new Request(`${origin}/api/workspaces/${created.workspace.id}`, {
      headers: actorB.jar.headers(),
    }),
    origin,
  );
  expect(removed.status).toBe(404);
  expect(
    (
      await authService.getSession(
        new Request(`${origin}/api/auth/session`, {
          headers: actorB.jar.headers(),
        }),
      )
    ).session,
  ).not.toBeNull();
  expect(provider.exchanges).toBe(2);
});
