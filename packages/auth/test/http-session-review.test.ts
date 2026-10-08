import {
  sessionDeviceListDtoSchema,
  sessionOutputDtoSchema,
} from "@holon/contracts/dashboard";
import { createTenancyPersistence } from "@holon/db/identity/server";
import { env, reset, type D1Migration } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";

import { createDashboardHandler } from "../../../apps/dashboard/app/server/http-app.server.js";
import {
  beginOAuth,
  completeOAuth,
  fakeGitHub,
  setupAuthService,
  testOrigin,
  testSecret,
} from "./support.js";

const bindings = env as { AUTH_DB: D1Database; AUTH_MIGRATIONS: D1Migration[] };
afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

async function fixture(database = bindings.AUTH_DB) {
  const authService = await setupAuthService({ database });
  const handle = createDashboardHandler(
    async () => new Response("Synthetic render"),
    {
      authService,
      tenancyPersistence: createTenancyPersistence(bindings.AUTH_DB),
      authSecret: testSecret,
    },
  );
  const github = fakeGitHub();
  async function signIn(code: string, id = 5201) {
    const flow = await beginOAuth(authService);
    github.authorize(
      code,
      { id, email: `session-review-${id}@example.invalid` },
      flow.authorizationURL,
    );
    expect((await completeOAuth(authService, flow, code)).status).toBe(302);
    const response = await handle(
      new Request(`${testOrigin}/api/auth/session`, {
        headers: flow.jar.headers(),
      }),
      testOrigin,
    );
    expect(response.status).toBe(200);
    const session = sessionOutputDtoSchema.parse(await response.json());
    const csrf = response.headers.get("X-CSRF-Token")!;
    expect(csrf).toMatch(/^[0-9a-f]{64}$/u);
    return { jar: flow.jar, session, csrf };
  }
  function command(
    actor: Awaited<ReturnType<typeof signIn>>,
    path: string,
    csrf = actor.csrf,
  ) {
    const headers = actor.jar.headers();
    headers.set("Origin", testOrigin);
    headers.set("Content-Type", "application/json");
    headers.set("X-CSRF-Token", csrf);
    return handle(
      new Request(`${testOrigin}${path}`, {
        method: "POST",
        headers,
        body: "{}",
      }),
      testOrigin,
    );
  }
  return { handle, signIn, command };
}

it("public device DTO lists only the authenticated user's sessions and refuses a foreign revocation", async () => {
  const { handle, signIn, command } = await fixture();
  const current = await signIn("devices-current");
  const otherDevice = await signIn("devices-other");
  const foreign = await signIn("devices-foreign", 5202);
  const response = await handle(
    new Request(
      `${testOrigin}/api/auth/sessions?userId=${foreign.session.user.id}`,
      { headers: current.jar.headers() },
    ),
    testOrigin,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  const dto = sessionDeviceListDtoSchema.parse(await response.json());
  expect(dto.sessions.map((session) => session.id).toSorted()).toEqual(
    [current.session.session.id, otherDevice.session.session.id].toSorted(),
  );
  expect(dto.sessions.find((session) => session.isCurrent)?.id).toBe(
    current.session.session.id,
  );
  await command(
    current,
    `/api/auth/sessions/${foreign.session.session.id}/revoke`,
  );
  expect(
    await bindings.AUTH_DB.prepare("SELECT COUNT(*) FROM session WHERE id=?")
      .bind(foreign.session.session.id)
      .first("COUNT(*)"),
  ).toBe(1);
});

it("denies CSRF and read-method revocations without changing the target device", async () => {
  const { handle, signIn, command } = await fixture();
  const current = await signIn("csrf-current");
  const target = await signIn("csrf-target");
  const path = `/api/auth/sessions/${target.session.session.id}/revoke`;
  expect((await command(current, path, "invalid-csrf")).status).toBe(403);
  for (const method of ["GET", "HEAD"]) {
    const response = await handle(
      new Request(`${testOrigin}${path}`, {
        method,
        headers: current.jar.headers(),
      }),
      testOrigin,
    );
    expect(response.status).not.toBe(200);
  }
  expect(
    await bindings.AUTH_DB.prepare("SELECT COUNT(*) FROM session WHERE id=?")
      .bind(target.session.session.id)
      .first("COUNT(*)"),
  ).toBe(1);
});

it("logout all revokes both own devices, leaves another user and denies the next private read", async () => {
  const { handle, signIn, command } = await fixture();
  const current = await signIn("all-current");
  const target = await signIn("all-target");
  const foreign = await signIn("all-foreign", 5202);
  const response = await command(current, "/api/auth/sign-out/all");
  expect(response.status).toBe(200);
  current.jar.capture(response);
  expect(current.jar.hasSession()).toBe(false);
  expect(
    await bindings.AUTH_DB.prepare(
      "SELECT COUNT(*) FROM session WHERE userId=?",
    )
      .bind(current.session.user.id)
      .first("COUNT(*)"),
  ).toBe(0);
  expect(
    await bindings.AUTH_DB.prepare(
      "SELECT COUNT(*) FROM session WHERE userId=?",
    )
      .bind(foreign.session.user.id)
      .first("COUNT(*)"),
  ).toBe(1);
  for (const actor of [current, target]) {
    const denied = await handle(
      new Request(`${testOrigin}/api/auth/sessions`, {
        headers: actor.jar.headers(),
      }),
      testOrigin,
    );
    expect([401, 403]).toContain(denied.status);
  }
  expect([401, 403]).toContain(
    (await command(current, "/api/auth/sign-out/all")).status,
  );
  expect(
    await bindings.AUTH_DB.prepare(
      "SELECT COUNT(*) FROM session WHERE userId=?",
    )
      .bind(foreign.session.user.id)
      .first("COUNT(*)"),
  ).toBe(1);
});

it.each(["revoked", "expired"])(
  "an actor %s after HTTP admission cannot revoke another device",
  async (change) => {
    let armed = false;
    let currentSessionId = "";
    async function revokeActor() {
      if (!armed) return;
      armed = false;
      if (change === "expired") {
        // The command already captured its clock. SQLite must check authority at the write.
        await new Promise((resolve) => setTimeout(resolve, 20));
        await bindings.AUTH_DB.prepare(
          "UPDATE session SET expiresAt = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id=?",
        )
          .bind(currentSessionId)
          .run();
      } else {
        await bindings.AUTH_DB.prepare("DELETE FROM session WHERE id=?")
          .bind(currentSessionId)
          .run();
      }
    }
    function wrap(statement: D1PreparedStatement): D1PreparedStatement {
      return new Proxy(statement, {
        get(target, property) {
          if (property === "bind")
            return (...values: unknown[]) => wrap(target.bind(...values));
          if (property === "run")
            return async () => {
              await revokeActor();
              return target.run();
            };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }
    const database = new Proxy(bindings.AUTH_DB, {
      get(target, property) {
        if (property === "prepare")
          return (sql: string) =>
            sql.startsWith("DELETE FROM session")
              ? wrap(target.prepare(sql))
              : target.prepare(sql);
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            await revokeActor();
            return target.batch(statements);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const { signIn, command } = await fixture(database);
    const current = await signIn("guard-current");
    const target = await signIn("guard-target");
    currentSessionId = current.session.session.id;
    armed = true;
    const response = await command(
      current,
      `/api/auth/sessions/${target.session.session.id}/revoke`,
    );
    expect(armed).toBe(false);
    expect
      .soft(
        await bindings.AUTH_DB.prepare(
          "SELECT COUNT(*) FROM session WHERE id=?",
        )
          .bind(target.session.session.id)
          .first("COUNT(*)"),
      )
      .toBe(1);
    expect([401, 403]).toContain(response.status);
  },
);
