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
import { CookieJar, fakeGitHub } from "./review-provider.js";

const origin = "https://localhost";
const secret = "synthetic-boundary-review-secret-only-for-tests-0001";
const bindings = env as { AUTH_DB: D1Database; AUTH_MIGRATIONS: D1Migration[] };

afterEach(async () => {
  vi.restoreAllMocks();
  expect(
    await bindings.AUTH_DB.prepare(
      "SELECT COUNT(*) AS count FROM tenancy_mutation_guard",
    ).first("count"),
  ).toBe(0);
  await reset();
});

async function fixture() {
  await applyD1Migrations(bindings.AUTH_DB, bindings.AUTH_MIGRATIONS);
  const authService = createAuthService({
    database: bindings.AUTH_DB,
    appOrigin: origin,
    authSecret: secret,
    githubClientId: "synthetic-client-id",
    githubClientSecret: "synthetic-client-secret",
    environment: "development",
  });
  const provider = fakeGitHub();
  const handle = createDashboardHandler(
    async () => new Response("Synthetic render"),
    {
      authService,
      tenancyPersistence: createTenancyPersistence(bindings.AUTH_DB),
      authSecret: secret,
    },
  );
  const jar = new CookieJar();
  const started = await handle(
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "github",
        callbackURL: "/",
        disableRedirect: true,
      }),
    }),
    origin,
  );
  expect(started.status).toBe(200);
  jar.capture(started);
  const authorization = new URL((await started.json<{ url: string }>()).url);
  provider.authorize(
    "boundary_review_code",
    { id: 93701, email: "boundary-review@example.invalid" },
    authorization,
  );
  const callback = new URL(`${origin}/api/auth/callback/github`);
  callback.searchParams.set("state", authorization.searchParams.get("state")!);
  callback.searchParams.set("code", "boundary_review_code");
  const completed = await handle(
    new Request(callback, { headers: jar.headers() }),
    origin,
  );
  expect(completed.status).toBe(302);
  jar.capture(completed);
  const session = await handle(
    new Request(`${origin}/api/auth/session`, { headers: jar.headers() }),
    origin,
  );
  expect(session.status).toBe(200);
  jar.capture(session);
  const csrf = session.headers.get("X-CSRF-Token");
  expect(csrf).toMatch(/^[0-9a-f]{64}$/u);
  return { handle, jar, csrf: csrf!, authService };
}

it("native logout denies missing session CSRF without revoking the session, then permits the protected command", async () => {
  const test = await fixture();
  for (const csrf of [undefined, "", "synthetic_wrong_csrf"]) {
    const headers = test.jar.headers();
    headers.set("Origin", origin);
    headers.set("Content-Type", "application/json");
    if (csrf !== undefined) headers.set("X-CSRF-Token", csrf);
    const rejected = await test.handle(
      new Request(`${origin}/api/auth/sign-out`, {
        method: "POST",
        headers,
        body: "{}",
      }),
      origin,
    );
    expect(rejected.status).toBe(403);
    expect(
      await bindings.AUTH_DB.prepare(
        "SELECT COUNT(*) AS count FROM session",
      ).first("count"),
    ).toBe(1);
    expect(rejected.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await rejected.text()).not.toContain(
      "boundary-review@example.invalid",
    );
  }
  const headers = test.jar.headers();
  headers.set("Origin", origin);
  headers.set("Content-Type", "application/json");
  headers.set("X-CSRF-Token", test.csrf);
  const completed = await test.handle(
    new Request(`${origin}/api/auth/sign-out`, {
      method: "POST",
      headers,
      body: "{}",
    }),
    origin,
  );
  expect(completed.status).toBe(200);
  expect(
    await bindings.AUTH_DB.prepare(
      "SELECT COUNT(*) AS count FROM session",
    ).first("count"),
  ).toBe(0);
});

it("an operation payload collision is classified without hiding it as storage unavailability", async () => {
  const test = await fixture();
  const headers = test.jar.headers();
  headers.set("Origin", origin);
  headers.set("Content-Type", "application/json");
  headers.set("X-CSRF-Token", test.csrf);
  const create = (name: string) =>
    test.handle(
      new Request(`${origin}/api/workspaces/team`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name, operationId: "boundary_review_team" }),
      }),
      origin,
    );
  expect((await create("Original team")).status).toBe(200);
  const conflict = await create("Changed intent");
  expect(conflict.status).toBe(409);
  expect(await conflict.json<{ error: { code: string } }>()).toMatchObject({
    error: { code: "invalid_request" },
  });
  expect(conflict.headers.get("Cache-Control")).toBe("private, no-store");
  expect(
    await bindings.AUTH_DB.prepare(
      "SELECT COUNT(*) AS count FROM workspace WHERE type='team'",
    ).first("count"),
  ).toBe(1);
  expect(
    await bindings.AUTH_DB.prepare(
      "SELECT COUNT(*) AS count FROM tenancy_operation",
    ).first("count"),
  ).toBe(1);
});

it("anonymous login rejects contradictory cross-site metadata before writing OAuth state", async () => {
  const test = await fixture();
  const response = await test.handle(
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Sec-Fetch-Site": "cross-site",
      },
      body: JSON.stringify({
        provider: "github",
        callbackURL: "/",
        disableRedirect: true,
      }),
    }),
    origin,
  );
  expect(response.status).toBe(403);
  expect(
    await bindings.AUTH_DB.prepare(
      "SELECT COUNT(*) AS count FROM verification",
    ).first("count"),
  ).toBe(0);
});

it("a native session whose GitHub identity is disconnected requests reconnection without granting workspace access", async () => {
  const test = await fixture();
  await bindings.AUTH_DB.prepare(
    "DELETE FROM account WHERE providerId='github'",
  ).run();
  const response = await test.handle(
    new Request(`${origin}/api/workspaces`, {
      headers: test.jar.headers(),
    }),
    origin,
  );
  expect(response.status).toBe(401);
  expect(await response.json<{ error: { code: string } }>()).toMatchObject({
    error: { code: "reconnect_required" },
  });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(
    await bindings.AUTH_DB.prepare(
      "SELECT COUNT(*) AS count FROM workspace",
    ).first("count"),
  ).toBe(0);
});

it.each([true, false])(
  "unavailable team confirmation after commit (lost acknowledgement: %s) reports unknown outcome, then recovers the same intent",
  async (loseAcknowledgement) => {
    const test = await fixture();
    let acknowledgementLost = false;
    const interrupted = new Proxy(bindings.AUTH_DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            const committed = await target.batch(statements);
            acknowledgementLost = true;
            if (loseAcknowledgement)
              throw new Error("synthetic-private-transport-error");
            return committed;
          };
        if (property === "prepare")
          return (sql: string) => {
            if (acknowledgementLost)
              throw new Error("synthetic-private-read-error");
            return target.prepare(sql);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const handle = createDashboardHandler(
      async () => new Response("Synthetic render"),
      {
        authService: test.authService,
        tenancyPersistence: createTenancyPersistence(interrupted),
        authSecret: secret,
      },
    );
    const headers = test.jar.headers();
    headers.set("Origin", origin);
    headers.set("Content-Type", "application/json");
    headers.set("X-CSRF-Token", test.csrf);
    const command = () =>
      new Request(`${origin}/api/workspaces/team`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Recoverable team",
          operationId: "lost_ack_team",
        }),
      });
    const unknown = await handle(command(), origin);
    expect(unknown.status).toBe(503);
    expect(await unknown.json<{ error: { code: string } }>()).toMatchObject({
      error: { code: "command_unknown" },
    });
    expect(unknown.headers.get("Cache-Control")).toBe("private, no-store");
    expect(
      await bindings.AUTH_DB.prepare(
        "SELECT COUNT(*) AS count FROM tenancy_operation",
      ).first("count"),
    ).toBe(1);
    expect((await test.handle(command(), origin)).status).toBe(200);
    expect(
      await bindings.AUTH_DB.prepare(
        "SELECT COUNT(*) AS count FROM workspace WHERE type='team'",
      ).first("count"),
    ).toBe(1);
  },
);

it("a durable actor mutation budget survives handler recreation and rejects abuse before another workspace effect", async () => {
  const test = await fixture();
  const headers = test.jar.headers();
  headers.set("Origin", origin);
  headers.set("Content-Type", "application/json");
  headers.set("X-CSRF-Token", test.csrf);
  const command = () =>
    new Request(`${origin}/api/workspaces/personal`, {
      method: "POST",
      headers,
      body: "{}",
    });
  for (let i = 0; i < 30; i += 1)
    expect((await test.handle(command(), origin)).status).toBe(200);
  const recreated = createDashboardHandler(
    async () => new Response("Synthetic render"),
    {
      authService: createAuthService({
        database: bindings.AUTH_DB,
        appOrigin: origin,
        authSecret: secret,
        githubClientId: "synthetic-client-id",
        githubClientSecret: "synthetic-client-secret",
        environment: "development",
      }),
      tenancyPersistence: createTenancyPersistence(bindings.AUTH_DB),
      authSecret: secret,
    },
  );
  const rejected = await recreated(command(), origin);
  expect(rejected.status).toBe(429);
  expect(Number(rejected.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  expect(Number(rejected.headers.get("Retry-After"))).toBeLessThanOrEqual(60);
  expect(await rejected.json<{ error: { code: string } }>()).toMatchObject({
    error: { code: "rate_limited" },
  });
  expect(
    await bindings.AUTH_DB.prepare(
      "SELECT COUNT(*) AS count FROM workspace",
    ).first("count"),
  ).toBe(1);
  expect(
    await bindings.AUTH_DB.prepare(
      "SELECT COUNT(*) AS count FROM membership",
    ).first("count"),
  ).toBe(1);
});

it("native anonymous login enforces its configured durable 10-per-minute policy with bounded Holon errors", async () => {
  const test = await fixture();
  const signIn = () =>
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "CF-Connecting-IP": "192.0.2.123",
      },
      body: JSON.stringify({
        provider: "github",
        callbackURL: "/",
        disableRedirect: true,
      }),
    });
  for (let i = 0; i < 10; i += 1)
    expect((await test.handle(signIn(), origin)).status).toBe(200);
  const blocked = await test.handle(signIn(), origin);
  expect(blocked.status).toBe(429);
  expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  expect(Number(blocked.headers.get("Retry-After"))).toBeLessThanOrEqual(60);
  expect(await blocked.json<{ error: { code: string } }>()).toMatchObject({
    error: { code: "rate_limited" },
  });
  expect(
    JSON.stringify(
      (await bindings.AUTH_DB.prepare("SELECT key FROM rate_limit").all())
        .results,
    ),
  ).not.toContain("192.0.2.123");
});

it("native rate-limit storage failure denies OAuth before state creation with sanitized unavailability", async () => {
  await applyD1Migrations(bindings.AUTH_DB, bindings.AUTH_MIGRATIONS);
  const unavailable = new Proxy(bindings.AUTH_DB, {
    get(target, property) {
      if (property === "prepare")
        return (sql: string) => {
          if (sql.includes("rate_limit"))
            throw new Error("synthetic-private-rate-storage-payload");
          return target.prepare(sql);
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const handle = createDashboardHandler(
    async () => new Response("Synthetic render"),
    {
      authService: createAuthService({
        database: unavailable,
        appOrigin: origin,
        authSecret: secret,
        githubClientId: "synthetic-client-id",
        githubClientSecret: "synthetic-client-secret",
        environment: "development",
      }),
      tenancyPersistence: createTenancyPersistence(bindings.AUTH_DB),
      authSecret: secret,
    },
  );
  const response = await handle(
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "github",
        callbackURL: "/",
        disableRedirect: true,
      }),
    }),
    origin,
  );
  expect(response.status).toBe(503);
  const body = await response.text();
  expect(JSON.parse(body)).toMatchObject({ error: { code: "unavailable" } });
  expect(body).not.toContain("synthetic-private-rate-storage-payload");
  expect(
    await bindings.AUTH_DB.prepare(
      "SELECT COUNT(*) AS count FROM verification",
    ).first("count"),
  ).toBe(0);
});

it.each(["/api/auth/session", "/api/workspaces"])(
  "public read %s has a durable bounded budget even though native server session APIs bypass the SDK limiter",
  async (path) => {
    const test = await fixture();
    const headers = test.jar.headers();
    headers.set("CF-Connecting-IP", "192.0.2.65");
    const existingKeys = new Set(
      (
        await bindings.AUTH_DB.prepare("SELECT key FROM rate_limit").all<{
          key: string;
        }>()
      ).results.map((row) => row.key),
    );
    const first = await test.handle(
      new Request(`${origin}${path}`, { headers }),
      origin,
    );
    expect(first.status).toBe(200);
    const added = (
      await bindings.AUTH_DB.prepare("SELECT key, count FROM rate_limit").all<{
        key: string;
        count: number;
      }>()
    ).results.filter((row) => !existingKeys.has(row.key));
    expect(added).toHaveLength(1);
    expect(added[0]!.count).toBe(1);
    const key = added[0]!.key;
    // Arrange a durable budget at the boundary; HTTP/D1 remain real and the
    // assertions below prove the configured ceiling without 120 setup requests.
    await bindings.AUTH_DB.prepare(
      "UPDATE rate_limit SET count=119 WHERE key=?",
    )
      .bind(key)
      .run();
    const lastPermitted = await test.handle(
      new Request(`${origin}${path}`, { headers }),
      origin,
    );
    expect(lastPermitted.status).toBe(200);
    expect(
      await bindings.AUTH_DB.prepare("SELECT count FROM rate_limit WHERE key=?")
        .bind(key)
        .first("count"),
    ).toBe(120);
    const blocked = await test.handle(
      new Request(`${origin}${path}`, { headers }),
      origin,
    );
    expect(
      await bindings.AUTH_DB.prepare("SELECT count FROM rate_limit WHERE key=?")
        .bind(key)
        .first("count"),
    ).toBe(121);
    if (path === "/api/workspaces") {
      for (const id of ["synthetic_missing_one", "synthetic_missing_two"]) {
        expect(
          (
            await test.handle(
              new Request(`${origin}/api/workspaces/${id}`, { headers }),
              origin,
            )
          ).status,
        ).toBe(429);
      }
    }
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThanOrEqual(
      1,
    );
    expect(Number(blocked.headers.get("Retry-After"))).toBeLessThanOrEqual(60);
    expect(await blocked.json<{ error: { code: string } }>()).toMatchObject({
      error: { code: "rate_limited" },
    });
    expect(
      await bindings.AUTH_DB.prepare(
        "SELECT COUNT(*) AS count FROM workspace",
      ).first("count"),
    ).toBe(0);
    const recreated = createDashboardHandler(
      async () => new Response("Synthetic render"),
      {
        authService: createAuthService({
          database: bindings.AUTH_DB,
          appOrigin: origin,
          authSecret: secret,
          githubClientId: "synthetic-client-id",
          githubClientSecret: "synthetic-client-secret",
          environment: "development",
        }),
        tenancyPersistence: createTenancyPersistence(bindings.AUTH_DB),
        authSecret: secret,
      },
    );
    expect(
      (await recreated(new Request(`${origin}${path}`, { headers }), origin))
        .status,
    ).toBe(429);
  },
);

it.each([
  ["personal", "revoke"],
  ["team", "revoke"],
  ["personal", "expire"],
  ["team", "expire"],
] as const)(
  "invalidating the command session at the %s batch (%s) denies the effect even while another device session survives",
  async (kind, invalidation) => {
    const test = await fixture();
    const resolution = await test.authService.getAdmittedUser(
      new Request(`${origin}/api/auth/session`, {
        headers: test.jar.headers(),
      }),
    );
    expect(resolution.user).not.toBeNull();
    const actor = resolution.user!;
    const now = Date.now();
    await bindings.AUTH_DB.prepare(
      "INSERT INTO session (id,token,userId,expiresAt,createdAt,updatedAt) VALUES ('other_device_session','synthetic_other_device_token',?,?,?,?)",
    )
      .bind(actor.id, now + 60000, now, now)
      .run();
    const interleaved = new Proxy(bindings.AUTH_DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            if (invalidation === "revoke") {
              await target
                .prepare("DELETE FROM session WHERE id=?")
                .bind(actor.sessionId)
                .run();
            } else {
              // Expiry occurs after statements were prepared; captured preflight time cannot authorize this batch.
              await new Promise((resolve) => setTimeout(resolve, 30));
              await target
                .prepare("UPDATE session SET expiresAt=? WHERE id=?")
                .bind(Date.now() - 5, actor.sessionId)
                .run();
            }
            return target.batch(statements);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const handle = createDashboardHandler(
      async () => new Response("Synthetic render"),
      {
        authService: test.authService,
        tenancyPersistence: createTenancyPersistence(interleaved),
        authSecret: secret,
      },
    );
    const headers = test.jar.headers();
    headers.set("Origin", origin);
    headers.set("Content-Type", "application/json");
    headers.set("X-CSRF-Token", test.csrf);
    const response = await handle(
      new Request(`${origin}/api/workspaces/${kind}`, {
        method: "POST",
        headers,
        body: JSON.stringify(
          kind === "personal"
            ? {}
            : {
                name: "Revoked intent",
                operationId: "revoked_command_session",
              },
        ),
      }),
      origin,
    );
    expect(response.status).toBe(403);
    expect(await response.json<{ error: { code: string } }>()).toMatchObject({
      error: { code: "denied" },
    });
    expect(
      await bindings.AUTH_DB.prepare(
        "SELECT COUNT(*) AS count FROM workspace",
      ).first("count"),
    ).toBe(0);
    expect(
      await bindings.AUTH_DB.prepare(
        "SELECT COUNT(*) AS count FROM membership",
      ).first("count"),
    ).toBe(0);
    expect(
      await bindings.AUTH_DB.prepare(
        "SELECT COUNT(*) AS count FROM tenancy_operation",
      ).first("count"),
    ).toBe(0);
    expect(
      await bindings.AUTH_DB.prepare(
        "SELECT id FROM session WHERE id='other_device_session'",
      ).first("id"),
    ).toBe("other_device_session");
  },
);
