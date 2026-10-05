import { reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createNativeProofAuth, origin } from "../src/auth.js";
import { handlePublicAuth } from "../src/public-handler.js";
import * as schema from "../src/schema.js";
import {
  beginOAuth,
  completeOAuth,
  fakeGitHub,
  interruptAccountInsert,
  interruptedSignupThenNewOAuth,
  setupAuth,
  signIn,
  snapshot,
} from "./support.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

const person = { id: 9001, email: "person@example.invalid" };

describe("real Better Auth + D1 composition and native baseline", () => {
  it("uses a fixture matching every Drizzle column and actual D1 foreign-key constraints", async () => {
    await setupAuth();
    for (const table of [
      schema.user,
      schema.session,
      schema.account,
      schema.verification,
    ]) {
      const config = getTableConfig(table);
      const physical = await env.AUTH_DB.prepare(
        `PRAGMA table_info("${config.name}")`,
      ).all<{ name: string }>();
      expect(physical.results.map((column) => column.name).toSorted()).toEqual(
        config.columns.map((column) => column.name).toSorted(),
      );
      for (const foreign of config.foreignKeys) {
        expect(foreign.reference().foreignTable).toBe(schema.user);
      }
    }
    await expect(
      env.AUTH_DB.prepare(`INSERT INTO session
      (id,expiresAt,token,createdAt,updatedAt,userId) VALUES ('invalid',1,'synthetic',1,1,'missing')`).run(),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it("signs up by the native GitHub OAuth route with a private verified email and encrypts provider tokens", async () => {
    const auth = await setupAuth();
    const github = fakeGitHub();
    const login = await signIn(auth, github, "normal", person);
    expect(login.response.status).toBe(302);
    expect(login.response.headers.get("Location")).toBe(`${origin}/signed-in`);
    expect(login.flow.jar.hasSession()).toBe(true);
    const rows = await snapshot();
    expect(rows.users).toHaveLength(1);
    expect(rows.accounts).toHaveLength(1);
    expect(rows.sessions).toHaveLength(1);
    expect(rows.users[0]).toMatchObject({
      email: person.email,
      emailVerified: 1,
    });
    expect(rows.accounts[0]).toMatchObject({
      accountId: "9001",
      providerId: "github",
      userId: rows.users[0]?.id,
    });
    expect(rows.accounts[0]?.accessToken).toEqual(expect.any(String));
    expect(rows.accounts[0]?.accessToken).not.toBe("synthetic-access-normal");
    expect(rows.accounts[0]?.refreshToken).toEqual(expect.any(String));
    expect(rows.accounts[0]?.refreshToken).not.toBe("synthetic-refresh-normal");
    const recoveredToken = await auth.api.getAccessToken({
      headers: login.flow.jar.headers(),
      body: { accountId: String(rows.accounts[0]?.id) },
    });
    expect(recoveredToken.accessToken).toBe("synthetic-access-normal");
    const cookie = login.response.headers
      .getSetCookie()
      .find((value) => value.includes("session_token="));
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Domain=");
  });

  it("rejects a consumed state/code and does not call the provider twice", async () => {
    const auth = await setupAuth();
    const github = fakeGitHub();
    const login = await signIn(auth, github, "single-use", person);
    const replay = await completeOAuth(
      auth,
      login.flow,
      "single-use",
      login.flow.initialHeaders,
    );
    expect(replay.headers.get("Location")).not.toBe(`${origin}/signed-in`);
    expect(github.exchanges).toBe(1);
    expect((await snapshot()).sessions).toHaveLength(1);
  });

  it.each(["drizzle", "native-d1"] as const)(
    "%s: native baseline without the plugin submits a concurrent code twice",
    async (persistence) => {
      await setupAuth(persistence);
      const auth = createNativeProofAuth(env.AUTH_DB, persistence);
      const github = fakeGitHub();
      const flow = await beginOAuth(auth);
      github.authorize("shared-code", person, flow.authorizationURL);
      const results = await Promise.all([
        completeOAuth(auth, flow, "shared-code", flow.initialHeaders),
        completeOAuth(auth, flow, "shared-code", flow.initialHeaders),
      ]);
      expect(
        results.filter(
          (response) =>
            response.headers.get("Location") === `${origin}/signed-in`,
        ),
      ).toHaveLength(1);
      expect(github.exchanges).toBe(2);
      expect((await snapshot()).sessions).toHaveLength(1);
    },
  );

  it.each(["drizzle", "native-d1"] as const)(
    "%s: recovers interrupted Account creation through native verified-email linking",
    async (persistence) => {
      const run = await interruptedSignupThenNewOAuth(persistence);
      expect(run.first.flow.jar.hasSession()).toBe(false);
      expect(run.interrupted.users).toHaveLength(1);
      expect(run.interrupted.accounts).toHaveLength(0);
      expect(run.interrupted.sessions).toHaveLength(0);
      expect(run.first.flow.state).not.toBe(run.fresh.flow.state);
      expect(run.github.exchanges).toBe(2);
      expect(run.fresh.response.headers.get("Location")).toBe(
        `${origin}/signed-in`,
      );
      expect(run.fresh.flow.jar.hasSession()).toBe(true);
      expect(run.final.users).toEqual(run.interrupted.users);
      expect(run.final.accounts).toHaveLength(1);
      expect(run.final.accounts[0]?.userId).toBe(run.interrupted.users[0]?.id);
      expect(run.final.sessions).toHaveLength(1);
    },
  );

  it.each(["user", "session"] as const)(
    "recovers a fresh login after failure at %s insert",
    async (table) => {
      const auth = await setupAuth();
      const github = fakeGitHub();
      await env.AUTH_DB.prepare(`CREATE TRIGGER synthetic_insert_failure BEFORE INSERT ON ${table}
      BEGIN SELECT RAISE(ABORT, 'synthetic_insert_failure'); END`).run();
      const interrupted = await signIn(auth, github, `before-${table}`, person);
      expect(interrupted.flow.jar.hasSession()).toBe(false);
      await env.AUTH_DB.prepare("DROP TRIGGER synthetic_insert_failure").run();
      const retry = await signIn(auth, github, `after-${table}`, person);
      expect(retry.flow.jar.hasSession()).toBe(true);
      const rows = await snapshot();
      expect(rows.users).toHaveLength(1);
      expect(rows.accounts).toHaveLength(1);
      expect(rows.sessions).toHaveLength(1);
    },
  );

  it("an email change after interrupted Account leaves the first User orphaned despite the same GitHub subject", async () => {
    const auth = await setupAuth();
    const github = fakeGitHub();
    await interruptAccountInsert();
    await signIn(auth, github, "email-before", person);
    const oldUser = (await snapshot()).users[0]?.id;
    await env.AUTH_DB.prepare(
      "DROP TRIGGER synthetic_account_insert_failure",
    ).run();
    const retry = await signIn(auth, github, "email-after", {
      ...person,
      email: "changed@example.invalid",
    });
    expect(retry.flow.jar.hasSession()).toBe(true);
    const rows = await snapshot();
    expect(rows.users).toHaveLength(2);
    expect(rows.accounts).toHaveLength(1);
    expect(rows.accounts[0]?.userId).not.toBe(oldUser);
    expect(rows.accounts[0]?.accountId).toBe("9001");
    expect(rows.sessions).toHaveLength(1);
    expect(rows.sessions[0]?.userId).toBe(rows.accounts[0]?.userId);
    expect(rows.sessions.some((session) => session.userId === oldUser)).toBe(
      false,
    );
  });

  it("converges concurrent callbacks for the same identity without duplicate users or account subjects", async () => {
    const auth = await setupAuth();
    const github = fakeGitHub();
    const left = await beginOAuth(auth);
    const right = await beginOAuth(auth);
    github.authorize("left", person, left.authorizationURL);
    github.authorize("right", person, right.authorizationURL);
    await Promise.all([
      completeOAuth(auth, left, "left"),
      completeOAuth(auth, right, "right"),
    ]);
    const retry = await signIn(auth, github, "after-race", person);
    expect(retry.flow.jar.hasSession()).toBe(true);
    const rows = await snapshot();
    expect(rows.users).toHaveLength(1);
    expect(rows.accounts).toHaveLength(1);
    expect(rows.accounts[0]?.userId).toBe(rows.users[0]?.id);
  });

  it("proves native session JSON includes the secret while the public DTO strips it", async () => {
    const auth = await setupAuth();
    const github = fakeGitHub();
    const login = await signIn(auth, github, "session", person);
    const native = await auth.handler(
      new Request(`${origin}/api/auth/get-session`, {
        headers: login.flow.jar.headers(),
      }),
    );
    const payload = (await native.json()) as { session: { token: string } };
    expect(payload.session.token).toBe((await snapshot()).sessions[0]?.token);
    const response = await handlePublicAuth(
      auth,
      new Request(`${origin}/session`, { headers: login.flow.jar.headers() }),
    );
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({
      user: { name: "Synthetic person" },
      session: { id: expect.any(String) },
    });
    expect(body).not.toContain(payload.session.token);
    expect(body).not.toContain("token");
    expect(body).not.toContain("synthetic-access");
    expect(body).not.toContain(person.email);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("reads current session after revocation and propagates every native renewal cookie", async () => {
    const auth = await setupAuth();
    const github = fakeGitHub();
    const login = await signIn(auth, github, "renewal", person);
    await env.AUTH_DB.prepare("UPDATE session SET updatedAt = ?, expiresAt = ?")
      .bind(Date.now() - 2 * 86400000, Date.now() + 86400000)
      .run();
    const response = await handlePublicAuth(
      auth,
      new Request(`${origin}/session`, { headers: login.flow.jar.headers() }),
    );
    expect(
      response.headers
        .getSetCookie()
        .some((cookie) => cookie.includes("session_token=")),
    ).toBe(true);
    await env.AUTH_DB.prepare("DELETE FROM session").run();
    const revoked = await handlePublicAuth(
      auth,
      new Request(`${origin}/session`, { headers: login.flow.jar.headers() }),
    );
    expect(await revoked.json()).toBeNull();
  });

  it("returns no session after its actual expiration in D1", async () => {
    const auth = await setupAuth();
    const github = fakeGitHub();
    const login = await signIn(auth, github, "expired", person);
    await env.AUTH_DB.prepare("UPDATE session SET expiresAt = ?")
      .bind(Date.now() - 1000)
      .run();
    const expired = await handlePublicAuth(
      auth,
      new Request(`${origin}/session`, { headers: login.flow.jar.headers() }),
    );
    expect(await expired.json()).toBeNull();
  });

  it("denies unexpected public paths/methods/providers, malformed JSON and origins", async () => {
    const auth = await setupAuth();
    fakeGitHub();
    for (const path of [
      "get-session",
      "list-sessions",
      "get-access-token",
      "refresh-token",
      "update-user",
      "link-social",
      "delete-user",
      "unknown",
      "callback/google",
    ]) {
      for (const method of ["GET", "POST"]) {
        const response = await handlePublicAuth(
          auth,
          new Request(`${origin}/api/auth/${path}`, { method }),
        );
        expect(response.status).toBe(404);
      }
    }
    expect(
      (
        await handlePublicAuth(
          auth,
          new Request(`${origin}/session`, { method: "POST" }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handlePublicAuth(
          auth,
          new Request("https://other.invalid/session"),
        )
      ).status,
    ).toBe(404);
    for (const body of [
      "{",
      "null",
      '"github"',
      "{}",
      '{"provider":"google"}',
      '{"provider":"github","idToken":{}}',
      '{"provider":"github","scopes":["repo"]}',
    ]) {
      const response = await handlePublicAuth(
        auth,
        new Request(`${origin}/api/auth/sign-in/social`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: origin },
          body,
        }),
      );
      expect(response.status).toBe(400);
    }
    const nativeOrigin = await auth.handler(
      new Request(`${origin}/api/auth/sign-in/social`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://untrusted.invalid",
        },
        body: JSON.stringify({
          provider: "github",
          callbackURL: `${origin}/signed-in`,
        }),
      }),
    );
    // Observe the native anonymous entry point; the Holon boundary must check its own origin.
    expect(nativeOrigin.status).toBe(200);
    const rejectedOrigin = await handlePublicAuth(
      auth,
      new Request(`${origin}/api/auth/sign-in/social`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://untrusted.invalid",
        },
        body: JSON.stringify({
          provider: "github",
          callbackURL: `${origin}/signed-in`,
        }),
      }),
    );
    expect(rejectedOrigin.status).toBe(403);
  });
});
