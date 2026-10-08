import { env, reset, type D1Migration } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";

import {
  beginOAuth,
  completeOAuth,
  fakeGitHub,
  setupAuthService,
  testOrigin,
} from "./support.js";

const bindings = env as { AUTH_DB: D1Database; AUTH_MIGRATIONS: D1Migration[] };
const day = 86_400_000;

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

function interleaveWrite(
  database: D1Database,
  matches: (sql: string) => boolean,
  beforeWrite: () => Promise<void>,
): D1Database {
  let intercepted = false;
  function wrap(statement: D1PreparedStatement): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, property) {
        if (property === "bind")
          return (...values: unknown[]) => wrap(target.bind(...values));
        if (property === "run" || property === "all")
          return async (...args: unknown[]) => {
            if (!intercepted) {
              intercepted = true;
              await beforeWrite();
            }
            return Reflect.apply(Reflect.get(target, property), target, args);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }
  return new Proxy(database, {
    get(target, property) {
      if (property === "prepare")
        return (sql: string) =>
          matches(sql) ? wrap(target.prepare(sql)) : target.prepare(sql);
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function login(auth: Awaited<ReturnType<typeof setupAuthService>>) {
  const github = fakeGitHub();
  const flow = await beginOAuth(auth);
  github.authorize(
    "review-clock-code",
    { id: 5101, email: "clock-review@example.invalid" },
    flow.authorizationURL,
  );
  expect((await completeOAuth(auth, flow, "review-clock-code")).status).toBe(
    302,
  );
  const request = () =>
    new Request(`${testOrigin}/api/auth/session`, {
      headers: flow.jar.headers(),
    });
  const resolved = await auth.getSession(request());
  expect(resolved.session).not.toBeNull();
  const sessionId = resolved.session!.session.id;
  const stored = await bindings.AUTH_DB.prepare(
    "SELECT updatedAt, expiresAt FROM session WHERE id = ?",
  )
    .bind(sessionId)
    .first<{ updatedAt: number; expiresAt: number }>();
  expect(stored).not.toBeNull();
  return { request, sessionId, stored: stored! };
}

it("renews at the persisted 24h boundary using only the injected clock", async () => {
  let now = Date.now();
  const auth = await setupAuthService({ clock: () => now });
  const { request, sessionId, stored } = await login(auth);
  now = stored.updatedAt + day - 1;
  const before = await auth.getSession(request());
  expect(before.session!.session.expiresAt).toBe(
    new Date(stored.expiresAt).toISOString(),
  );
  expect(
    before.headers
      .getSetCookie()
      .some((cookie) => cookie.includes("session_token")),
  ).toBe(false);
  now += 1;
  const renewed = await auth.getSession(request());
  expect(renewed.session!.session.expiresAt).toBe(
    new Date(now + 7 * day).toISOString(),
  );
  expect(
    renewed.headers
      .getSetCookie()
      .some((cookie) => cookie.includes("session_token")),
  ).toBe(true);
  expect(
    await bindings.AUTH_DB.prepare("SELECT expiresAt FROM session WHERE id = ?")
      .bind(sessionId)
      .first("expiresAt"),
  ).toBe(now + 7 * day);
  expect(Date.now()).toBeLessThan(now);
});

it("uses the injected session clock at issuance as well as renewal", async () => {
  const now = Date.parse("2030-01-01T00:00:00.000Z");
  const auth = await setupAuthService({ clock: () => now });
  const github = fakeGitHub();
  const flow = await beginOAuth(auth);
  github.authorize(
    "review-issued-clock",
    { id: 5102, email: "issued-clock@example.invalid" },
    flow.authorizationURL,
  );
  expect((await completeOAuth(auth, flow, "review-issued-clock")).status).toBe(
    302,
  );
  const stored = await bindings.AUTH_DB.prepare(
    "SELECT createdAt, updatedAt, expiresAt FROM session",
  ).first();
  expect(stored).toEqual({
    createdAt: now,
    updatedAt: now,
    expiresAt: now + 7 * day,
  });
  expect(
    (
      await auth.getSession(
        new Request(`${testOrigin}/api/auth/session`, {
          headers: flow.jar.headers(),
        }),
      )
    ).session,
  ).not.toBeNull();
});

it("denies an untouched session at its exact persisted expiry", async () => {
  let now = Date.now();
  const auth = await setupAuthService({ clock: () => now });
  const { request, sessionId, stored } = await login(auth);
  now = stored.expiresAt;
  const expired = await auth.getSession(request());
  expect(expired.session).toBeNull();
  expect((await auth.getAdmittedUser(request())).user).toBeNull();
  expect(
    await bindings.AUTH_DB.prepare("SELECT COUNT(*) FROM session WHERE id = ?")
      .bind(sessionId)
      .first("COUNT(*)"),
  ).toBe(0);
});

it("a revocation after the read and before the renewal write cannot resurrect a session", async () => {
  let now = Date.now();
  let sessionId = "";
  const database = interleaveWrite(
    bindings.AUTH_DB,
    (sql) => /^UPDATE\s+session\s+SET\s+expiresAt/iu.test(sql),
    async () => {
      await bindings.AUTH_DB.prepare("DELETE FROM session WHERE id = ?")
        .bind(sessionId)
        .run();
    },
  );
  const auth = await setupAuthService({ database, clock: () => now });
  const loggedIn = await login(auth);
  sessionId = loggedIn.sessionId;
  now = loggedIn.stored.updatedAt + day;
  expect((await auth.getSession(loggedIn.request())).session).toBeNull();
  expect(
    await bindings.AUTH_DB.prepare("SELECT COUNT(*) FROM session WHERE id = ?")
      .bind(sessionId)
      .first("COUNT(*)"),
  ).toBe(0);
});

it("a stale renewal cannot shorten a newer concurrent renewal", async () => {
  let now = Date.now();
  let later = now;
  let request: () => Request;
  const newerAuth = await setupAuthService({ clock: () => later });
  const database = interleaveWrite(
    bindings.AUTH_DB,
    (sql) => /^UPDATE\s+session\s+SET\s+expiresAt/iu.test(sql),
    async () => {
      expect((await newerAuth.getSession(request())).session).not.toBeNull();
    },
  );
  const auth = await setupAuthService({ database, clock: () => now });
  const loggedIn = await login(auth);
  request = loggedIn.request;
  now = loggedIn.stored.updatedAt + day;
  later = now + 3_600_000;
  await auth.getSession(request());
  expect(
    await bindings.AUTH_DB.prepare("SELECT expiresAt FROM session WHERE id = ?")
      .bind(loggedIn.sessionId)
      .first("expiresAt"),
  ).toBe(later + 7 * day);
});

it("renewal cannot revive a row whose persisted expiry changed after the SDK read", async () => {
  let now = Date.now();
  let sessionId = "";
  const database = interleaveWrite(
    bindings.AUTH_DB,
    (sql) => /^UPDATE\s+session\s+SET\s+expiresAt/iu.test(sql),
    async () => {
      await bindings.AUTH_DB.prepare(
        "UPDATE session SET expiresAt = ? WHERE id = ?",
      )
        .bind(now - 1, sessionId)
        .run();
    },
  );
  const auth = await setupAuthService({ database, clock: () => now });
  const loggedIn = await login(auth);
  sessionId = loggedIn.sessionId;
  now = loggedIn.stored.updatedAt + day;
  expect((await auth.getSession(loggedIn.request())).session).toBeNull();
  const expiry = await bindings.AUTH_DB.prepare(
    "SELECT expiresAt FROM session WHERE id = ?",
  )
    .bind(sessionId)
    .first<number>("expiresAt");
  expect(expiry === null || expiry <= now).toBe(true);
});

it("expiry of an old snapshot cannot delete a session renewed before the expiry write", async () => {
  let now = Date.now();
  let earlier = now;
  let request: () => Request;
  const renewingAuth = await setupAuthService({ clock: () => earlier });
  const database = interleaveWrite(
    bindings.AUTH_DB,
    (sql) => sql.startsWith("DELETE FROM session WHERE id"),
    async () => {
      expect((await renewingAuth.getSession(request())).session).not.toBeNull();
    },
  );
  const auth = await setupAuthService({ database, clock: () => now });
  const loggedIn = await login(auth);
  request = loggedIn.request;
  earlier = loggedIn.stored.expiresAt - 1;
  now = loggedIn.stored.expiresAt;
  await auth.getSession(request());
  expect(
    await bindings.AUTH_DB.prepare("SELECT expiresAt FROM session WHERE id = ?")
      .bind(loggedIn.sessionId)
      .first("expiresAt"),
  ).toBe(earlier + 7 * day);
});

it("native wall-clock expiry cannot delete a row renewed after the SDK read", async () => {
  let sessionId = "";
  let renewedExpiry = 0;
  let intercepted = false;
  const database = interleaveWrite(
    bindings.AUTH_DB,
    (sql) => /^delete\s+from\s+"?session"?/iu.test(sql),
    async () => {
      intercepted = true;
      renewedExpiry = Date.now() + 7 * day;
      await bindings.AUTH_DB.prepare(
        "UPDATE session SET expiresAt = ?, updatedAt = ? WHERE id = ?",
      )
        .bind(renewedExpiry, Date.now(), sessionId)
        .run();
    },
  );
  const auth = await setupAuthService({ database });
  const loggedIn = await login(auth);
  sessionId = loggedIn.sessionId;
  await bindings.AUTH_DB.prepare(
    "UPDATE session SET expiresAt = ? WHERE id = ?",
  )
    .bind(Date.now() - 1_000, sessionId)
    .run();
  const recovered = await auth.getSession(loggedIn.request());
  expect(intercepted).toBe(true);
  expect(recovered.session?.session.expiresAt).toBe(
    new Date(renewedExpiry).toISOString(),
  );
  expect(
    recovered.headers
      .getSetCookie()
      .some((cookie) => cookie.includes("Max-Age=604800")),
  ).toBe(true);
  expect(
    await bindings.AUTH_DB.prepare("SELECT expiresAt FROM session WHERE id = ?")
      .bind(sessionId)
      .first("expiresAt"),
  ).toBe(renewedExpiry);
});
