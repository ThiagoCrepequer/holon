import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins";
import { reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createProofAuth, origin } from "../src/auth.js";
import {
  pruneExpiredGithubCodes,
  reserveGithubCode,
} from "../src/github-code-redemption.js";
import { handlePublicAuth } from "../src/public-handler.js";
import {
  beginOAuth,
  completeOAuth,
  fakeGitHub,
  setupAuth,
  signIn,
  snapshot,
} from "./support.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});
const person = { id: 9001, email: "person@example.invalid" };

async function markers() {
  return (
    await env.AUTH_DB.prepare(
      "SELECT fingerprint, expires_at FROM github_code_redemption ORDER BY fingerprint",
    ).all()
  ).results;
}

describe.each(["drizzle", "native-d1"] as const)(
  "%s: durable GitHub code reservation",
  (persistence) => {
    it("independent auth instances submit a concurrent code once and persist only a digest and expiry", async () => {
      const auth = await setupAuth(persistence);
      const github = fakeGitHub();
      const flow = await beginOAuth(auth);
      github.authorize("concurrent", person, flow.authorizationURL);
      const responses = await Promise.all([
        completeOAuth(auth, flow, "concurrent", flow.initialHeaders),
        completeOAuth(
          createProofAuth(env.AUTH_DB, persistence),
          flow,
          "concurrent",
          flow.initialHeaders,
        ),
      ]);
      expect(github.exchanges).toBe(1);
      expect(github.acceptedExchanges).toBe(1);
      expect(
        responses.filter(
          (r) => r.headers.get("Location") === `${origin}/signed-in`,
        ),
      ).toHaveLength(1);
      expect((await snapshot()).sessions).toHaveLength(1);
      expect(await markers()).toEqual([
        {
          fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
          expires_at: expect.any(Number),
        },
      ]);
    });
    it("a fresh state and auth instance cannot resubmit a previous code", async () => {
      const auth = await setupAuth(persistence);
      const github = fakeGitHub();
      await signIn(auth, github, "previous", person);
      const restarted = createProofAuth(env.AUTH_DB, persistence);
      const flow = await beginOAuth(restarted);
      const response = await completeOAuth(restarted, flow, "previous");
      expect(response.headers.get("Location")).not.toBe(`${origin}/signed-in`);
      expect(github.exchanges).toBe(1);
      expect((await snapshot()).sessions).toHaveLength(1);
    });
    it.each(["missing", "foreign", "expired"] as const)(
      "%s browser transaction cannot burn a code",
      async (kind) => {
        const auth = await setupAuth(persistence);
        const github = fakeGitHub();
        const flow = await beginOAuth(auth);
        github.authorize("bound", person, flow.authorizationURL);
        const foreign = kind === "foreign" ? await beginOAuth(auth) : null;
        if (kind === "expired")
          await env.AUTH_DB.prepare(
            "UPDATE verification SET value = json_set(value, '$.expiresAt', 1), expiresAt = 1 WHERE identifier = ?",
          )
            .bind(`auth-state:${flow.state}`)
            .run();
        const response = await completeOAuth(
          auth,
          flow,
          "bound",
          foreign?.initialHeaders ??
            (kind === "missing" ? new Headers() : flow.initialHeaders),
        );
        expect(response.headers.get("Location")).not.toBe(
          `${origin}/signed-in`,
        );
        expect(await markers()).toHaveLength(0);
        expect(github.exchanges).toBe(0);
        if (kind !== "expired") {
          expect(
            (
              await completeOAuth(auth, flow, "bound", flow.initialHeaders)
            ).headers.get("Location"),
          ).toBe(`${origin}/signed-in`);
        }
      },
    );
    it("failed reservation denies token exchange; a new OAuth recovers after storage is restored", async () => {
      const auth = await setupAuth(persistence);
      const github = fakeGitHub();
      await env.AUTH_DB.prepare(
        "CREATE TRIGGER claim_failure BEFORE INSERT ON github_code_redemption BEGIN SELECT RAISE(ABORT, 'synthetic_claim_failure'); END",
      ).run();
      const failed = await signIn(auth, github, "failed", person);
      expect(failed.flow.jar.hasSession()).toBe(false);
      expect(github.exchanges).toBe(0);
      expect(await markers()).toHaveLength(0);
      await env.AUTH_DB.prepare("DROP TRIGGER claim_failure").run();
      const fresh = await signIn(auth, github, "fresh", person);
      expect(fresh.flow.jar.hasSession()).toBe(true);
      expect(github.exchanges).toBe(1);
    });
    it("a lost provider response does not release the reservation; recovery uses a new code", async () => {
      const auth = await setupAuth(persistence);
      const github = fakeGitHub();
      const controlledFetch = vi
        .mocked(globalThis.fetch)
        .getMockImplementation();
      if (!controlledFetch) throw new Error("Missing external fixture");
      let lose = true;
      vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
        const response = await controlledFetch(input, init);
        if (
          lose &&
          new Request(input, init).url ===
            "https://github.com/login/oauth/access_token"
        ) {
          lose = false;
          throw new Error("synthetic_response_lost");
        }
        return response;
      });
      const failed = await signIn(auth, github, "uncertain", person);
      expect(failed.flow.jar.hasSession()).toBe(false);
      expect(github.acceptedExchanges).toBe(1);
      expect((await snapshot()).sessions).toHaveLength(0);
      expect(await markers()).toHaveLength(1);
      const replay = await completeOAuth(
        createProofAuth(env.AUTH_DB, persistence),
        await beginOAuth(auth),
        "uncertain",
      );
      expect(replay.headers.get("Location")).not.toBe(`${origin}/signed-in`);
      expect(github.exchanges).toBe(1);
      expect(
        (await signIn(auth, github, "recovery", person)).flow.jar.hasSession(),
      ).toBe(true);
      expect(github.exchanges).toBe(2);
    });
  },
);

it("cleans at most 100 expired markers per callback and preserves every unexpired reservation", async () => {
  const auth = await setupAuth();
  const github = fakeGitHub();
  await signIn(auth, github, "protected", person);
  await env.AUTH_DB.prepare(`WITH RECURSIVE expired(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM expired WHERE n<101)
    INSERT INTO github_code_redemption SELECT printf('%064d',n), 1 FROM expired`).run();
  await signIn(auth, github, "cleanup-one", person);
  expect(
    await env.AUTH_DB.prepare(
      "SELECT count(*) AS count FROM github_code_redemption WHERE expires_at = 1",
    ).first(),
  ).toEqual({ count: 1 });
  const replay = await completeOAuth(auth, await beginOAuth(auth), "protected");
  expect(replay.headers.get("Location")).not.toBe(`${origin}/signed-in`);
  expect(github.exchanges).toBe(2);
  expect(await markers()).toHaveLength(2);
});

it("maintenance after an idle period drains expired reservations without deleting live markers", async () => {
  await setupAuth();
  const before = await env.AUTH_DB.prepare(
    "SELECT CAST(strftime('%s','now') AS INTEGER) AS now",
  ).first<{ now: number }>();
  expect(await reserveGithubCode(env.AUTH_DB, "client-one", "protected")).toBe(
    true,
  );
  const after = await env.AUTH_DB.prepare(
    "SELECT CAST(strftime('%s','now') AS INTEGER) AS now",
  ).first<{ now: number }>();
  const expiry = (await markers())[0]?.expires_at;
  expect(expiry).toBeGreaterThanOrEqual(Number(before?.now) + 86400);
  expect(expiry).toBeLessThanOrEqual(Number(after?.now) + 86400);
  await env.AUTH_DB.prepare(`WITH RECURSIVE expired(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM expired WHERE n<201)
    INSERT INTO github_code_redemption SELECT printf('%064d',n), 1 FROM expired`).run();
  await pruneExpiredGithubCodes(env.AUTH_DB);
  expect(await markers()).toHaveLength(102);
  await pruneExpiredGithubCodes(env.AUTH_DB);
  expect(await markers()).toHaveLength(2);
  await pruneExpiredGithubCodes(env.AUTH_DB);
  expect(await markers()).toHaveLength(1);
  expect(await reserveGithubCode(env.AUTH_DB, "client-one", "protected")).toBe(
    false,
  );
});

it("reservation scope includes the OAuth client, survives an independent caller and never renews a duplicate", async () => {
  await setupAuth();
  expect(await reserveGithubCode(env.AUTH_DB, "client-one", "same-code")).toBe(
    true,
  );
  const original = await markers();
  expect(await reserveGithubCode(env.AUTH_DB, "client-one", "same-code")).toBe(
    false,
  );
  expect(await markers()).toEqual(original);
  expect(await reserveGithubCode(env.AUTH_DB, "client-two", "same-code")).toBe(
    true,
  );
  expect(await markers()).toHaveLength(2);
});

it("a failed reservation rolls cleanup back and denies egress", async () => {
  const auth = await setupAuth();
  const github = fakeGitHub();
  await env.AUTH_DB.prepare("INSERT INTO github_code_redemption VALUES (?,1)")
    .bind("a".repeat(64))
    .run();
  await env.AUTH_DB.prepare(
    "CREATE TRIGGER claim_failure BEFORE INSERT ON github_code_redemption BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  ).run();
  const failed = await signIn(auth, github, "rollback", person);
  expect(failed.flow.jar.hasSession()).toBe(false);
  expect(github.exchanges).toBe(0);
  expect(await markers()).toEqual([
    { fingerprint: "a".repeat(64), expires_at: 1 },
  ]);
});

it.each([
  "null",
  "{}",
  "[]",
  "[null,null]",
  "[{},{}]",
  '[{"success":false,"results":[]},{"success":true,"results":[]}]',
  '[{"success":true,"results":null},{"success":true,"results":[]}]',
  '[{"success":true,"results":[]},{"success":true}]',
  '[{"success":true,"results":[]},{"success":true,"results":[null]}]',
  '[{"success":true,"results":[]},{"success":true,"results":[1]}]',
  '[{"success":true,"results":[]},{"success":true,"results":[{}]}]',
  '[{"success":true,"results":[]},{"success":true,"results":[{"fingerprint":"wrong"}]}]',
  '[{"success":true,"results":[]},{"success":true,"results":[{},{}]}]',
])(
  "denies egress on malformed or ambiguous D1 result %s",
  async (serialized) => {
    const auth = await setupAuth();
    const github = fakeGitHub();
    const flow = await beginOAuth(auth);
    github.authorize("malformed", person, flow.authorizationURL);
    vi.spyOn(env.AUTH_DB, "batch").mockImplementationOnce(async () =>
      JSON.parse(serialized),
    );
    const response = await completeOAuth(auth, flow, "malformed");
    expect(response.headers.get("Location")).not.toBe(`${origin}/signed-in`);
    expect(github.exchanges).toBe(0);
    expect((await snapshot()).sessions).toHaveLength(0);
  },
);

it("maintenance propagates storage failure and never removes a live marker", async () => {
  await setupAuth();
  await reserveGithubCode(env.AUTH_DB, "client-one", "protected");
  await env.AUTH_DB.prepare("INSERT INTO github_code_redemption VALUES (?,1)")
    .bind("b".repeat(64))
    .run();
  await env.AUTH_DB.prepare(
    "CREATE TRIGGER cleanup_failure BEFORE DELETE ON github_code_redemption BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  ).run();
  await expect(pruneExpiredGithubCodes(env.AUTH_DB)).rejects.toThrow();
  expect(await markers()).toHaveLength(2);
});

it("rejects missing or dynamic GitHub configuration at startup", async () => {
  const auth = await setupAuth();
  const missing = betterAuth({ ...auth.options, socialProviders: {} });
  await expect(missing.$context).rejects.toThrow(
    "GitHub redemption requires one static GitHub client",
  );
  const dynamic = betterAuth({
    ...auth.options,
    socialProviders: {
      github: async () => ({
        clientId: "synthetic-client-id",
        clientSecret: "synthetic-client-secret",
      }),
    },
  });
  await expect(dynamic.$context).rejects.toThrow(
    "GitHub redemption requires one static GitHub client",
  );
});

it("does not expose an unqualified provider through the restricted public surface", async () => {
  const auth = await setupAuth();
  const github = fakeGitHub();
  const extended = betterAuth({
    ...auth.options,
    socialProviders: {
      ...auth.options.socialProviders,
      google: {
        clientId: "synthetic-google",
        clientSecret: "synthetic-google-secret",
      },
    },
  });
  expect(
    (
      await signIn(extended, github, "github-only", person)
    ).flow.jar.hasSession(),
  ).toBe(true);
  const denied = await handlePublicAuth(
    extended,
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ provider: "google" }),
    }),
  );
  expect(denied.status).toBe(400);
  expect(github.exchanges).toBe(1);
});

it("rejects two providers using the GitHub identifier rather than silently guarding the wrong client", async () => {
  const auth = await setupAuth();
  const ambiguous = betterAuth({
    ...auth.options,
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: "github",
            clientId: "synthetic-other",
            clientSecret: "synthetic-other-secret",
            authorizationUrl: "https://other.invalid/auth",
            tokenUrl: "https://other.invalid/token",
            userInfoUrl: "https://other.invalid/user",
          },
        ],
      }),
      ...auth.options.plugins,
    ],
  });
  await expect(ambiguous.$context).rejects.toThrow(
    "GitHub redemption requires one static GitHub client",
  );
});

it("maintenance rejects a binding-reported cleanup failure", async () => {
  await setupAuth();
  const prepare = env.AUTH_DB.prepare.bind(env.AUTH_DB);
  vi.spyOn(env.AUTH_DB, "prepare").mockImplementationOnce((sql) => {
    const statement = prepare(sql);
    vi.spyOn(statement, "run").mockImplementationOnce(async () =>
      JSON.parse('{"success":false}'),
    );
    return statement;
  });
  await expect(pruneExpiredGithubCodes(env.AUTH_DB)).rejects.toThrow(
    "OAuth reservation cleanup failed",
  );
});

it("after reservation retention, an expired code is denied by the authorization server; a new OAuth succeeds", async () => {
  const auth = await setupAuth();
  let serverTime = Date.now();
  const github = fakeGitHub({ now: () => serverTime });
  const initial = await signIn(auth, github, "old", person);
  expect(initial.flow.jar.hasSession()).toBe(true);
  const unusedURL = new URL("https://github.com/login/oauth/authorize");
  unusedURL.searchParams.set("client_id", "synthetic-client-id");
  unusedURL.searchParams.set(
    "redirect_uri",
    `${origin}/api/auth/callback/github`,
  );
  github.authorize("unredeemed-expired", person, unusedURL);
  serverTime += 86400000;
  // An unconsumed code with matching client/redirect must fail specifically by
  // expiry, independently of consumed-code or PKCE-mismatch rejection.
  const expired = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: "synthetic-client-id",
      client_secret: "synthetic-client-secret",
      code: "unredeemed-expired",
      redirect_uri: `${origin}/api/auth/callback/github`,
    }),
  });
  expect(await expired.json()).toEqual({ error: "bad_verification_code" });
  expect(github.acceptedExchanges).toBe(1);
  await env.AUTH_DB.prepare(
    "UPDATE github_code_redemption SET expires_at = CAST(strftime('%s','now') AS INTEGER)",
  ).run();
  await pruneExpiredGithubCodes(env.AUTH_DB);
  expect(await markers()).toHaveLength(0);
  const fresh = await beginOAuth(auth);
  expect(
    (await completeOAuth(auth, fresh, "old")).headers.get("Location"),
  ).not.toBe(`${origin}/signed-in`);
  expect(github.exchanges).toBe(3);
  expect(github.acceptedExchanges).toBe(1);
  expect(
    (await signIn(auth, github, "new", person)).flow.jar.hasSession(),
  ).toBe(true);
  expect((await snapshot()).accounts).toHaveLength(1);
});
