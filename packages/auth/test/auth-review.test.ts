import {
  applyD1Migrations,
  env,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";

import { createAuthService, type AuthService } from "../src/server.js";
import {
  CookieJar,
  fakeGitHub,
  type GitHubIdentity,
} from "./review-provider.js";

const origin = "https://localhost";
const bindings = env as { AUTH_DB: D1Database; AUTH_MIGRATIONS: D1Migration[] };
const options = {
  appOrigin: origin,
  authSecret: "synthetic-review-secret-only-for-local-tests-0001",
  githubClientId: "synthetic-client-id",
  githubClientSecret: "synthetic-client-secret",
  environment: "development" as const,
};

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

async function setup() {
  await applyD1Migrations(bindings.AUTH_DB, bindings.AUTH_MIGRATIONS);
  return createAuthService({ database: bindings.AUTH_DB, ...options });
}

async function begin(auth: AuthService) {
  const jar = new CookieJar();
  const response = await auth.handleAuthRequest(
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "github",
        callbackURL: `${origin}/app`,
        disableRedirect: true,
      }),
    }),
  );
  expect(response.status).toBe(200);
  jar.capture(response);
  const payload = (await response.json()) as { url: string };
  const authorizationURL = new URL(payload.url);
  const state = authorizationURL.searchParams.get("state");
  expect(state).toBeTruthy();
  return { jar, authorizationURL, state: state! };
}

function callback(flow: Awaited<ReturnType<typeof begin>>, code: string) {
  const url = new URL(`${origin}/api/auth/callback/github`);
  url.searchParams.set("code", code);
  url.searchParams.set("state", flow.state);
  return new Request(url, { headers: flow.jar.headers() });
}

async function login(
  auth: AuthService,
  provider: ReturnType<typeof fakeGitHub>,
  code: string,
  identity: GitHubIdentity,
) {
  const flow = await begin(auth);
  provider.authorize(code, identity, flow.authorizationURL);
  const response = await auth.handleAuthRequest(callback(flow, code));
  flow.jar.capture(response);
  return { flow, response };
}

it("native GitHub login encrypts persisted tokens and the public session contains only DTO fields", async () => {
  const auth = await setup();
  expect(auth).not.toHaveProperty("auth");
  const provider = fakeGitHub();
  const signedIn = await login(auth, provider, "review_native", {
    id: 91001,
    email: "review-native@example.invalid",
  });
  expect(signedIn.response.status).toBe(302);
  expect(signedIn.flow.jar.hasSession()).toBe(true);
  expect(signedIn.flow.authorizationURL.searchParams.get("redirect_uri")).toBe(
    `${origin}/api/auth/callback/github`,
  );
  expect(signedIn.flow.authorizationURL.searchParams.get("scope") ?? "").toBe(
    "",
  );
  const cookies = signedIn.response.headers.getSetCookie();
  expect(cookies.length).toBeGreaterThan(1);
  const sessionCookie = cookies.find((cookie) =>
    cookie.includes("session_token="),
  );
  expect(sessionCookie).toContain("HttpOnly");
  expect(sessionCookie).toContain("Secure");
  expect(sessionCookie).toMatch(/SameSite=Lax/iu);
  expect(sessionCookie).not.toMatch(/Domain=/iu);
  const account = await bindings.AUTH_DB.prepare(
    "SELECT accessToken,refreshToken FROM account",
  ).first<{ accessToken: string; refreshToken: string }>();
  expect(account?.accessToken).toBeTruthy();
  expect(account?.refreshToken).toBeTruthy();
  expect(account?.accessToken).not.toContain("synthetic-access-");
  expect(account?.refreshToken).not.toContain("synthetic-refresh-");
  const session = await auth.handleAuthRequest(
    new Request(`${origin}/api/auth/session`, {
      headers: signedIn.flow.jar.headers(),
    }),
  );
  expect(session.headers.get("Cache-Control")).toBe("private, no-store");
  const output = (await session.json()) as {
    user: Record<string, unknown>;
    session: Record<string, unknown>;
  };
  expect(Object.keys(output).toSorted()).toEqual(["session", "user"]);
  expect(Object.keys(output.user).toSorted()).toEqual(["id", "name"]);
  expect(Object.keys(output.session).toSorted()).toEqual(["expiresAt", "id"]);
  expect(JSON.stringify(output)).not.toContain("synthetic-");
  expect(provider.exchanges).toBe(1);
});

it("two concurrent native callbacks can attempt a code redemption only once", async () => {
  const first = await setup();
  const second = createAuthService({ database: bindings.AUTH_DB, ...options });
  const provider = fakeGitHub();
  const flows = await Promise.all([begin(first), begin(second)]);
  provider.authorize(
    "review_shared",
    { id: 91002, email: "review-shared@example.invalid" },
    flows[0].authorizationURL,
  );
  await Promise.all([
    first.handleAuthRequest(callback(flows[0], "review_shared")),
    second.handleAuthRequest(callback(flows[1], "review_shared")),
  ]);
  expect(provider.exchanges).toBe(1);
  expect(
    (await bindings.AUTH_DB.prepare("SELECT id FROM user").all()).results,
  ).toHaveLength(1);
  expect(
    (await bindings.AUTH_DB.prepare("SELECT id FROM account").all()).results,
  ).toHaveLength(1);
  expect(
    (await bindings.AUTH_DB.prepare("SELECT id FROM session").all()).results,
  ).toHaveLength(1);
});

it("concurrent fresh codes preserve one account identity and a new OAuth remains usable", async () => {
  const first = await setup();
  const second = createAuthService({ database: bindings.AUTH_DB, ...options });
  const provider = fakeGitHub();
  const flows = await Promise.all([begin(first), begin(second)]);
  const identity = { id: 91009, email: "review-fresh-race@example.invalid" };
  provider.authorize("review_fresh_a", identity, flows[0].authorizationURL);
  provider.authorize("review_fresh_b", identity, flows[1].authorizationURL);
  await Promise.all([
    first.handleAuthRequest(callback(flows[0], "review_fresh_a")),
    second.handleAuthRequest(callback(flows[1], "review_fresh_b")),
  ]);
  expect(provider.exchanges).toBe(2);
  expect(
    (await bindings.AUTH_DB.prepare("SELECT id FROM user").all()).results,
  ).toHaveLength(1);
  expect(
    (await bindings.AUTH_DB.prepare("SELECT id FROM account").all()).results,
  ).toHaveLength(1);
  const persistedUser = await bindings.AUTH_DB.prepare(
    "SELECT id FROM user",
  ).first<{ id: string }>();
  const recovered = await login(
    first,
    provider,
    "review_fresh_after_race",
    identity,
  );
  expect(recovered.flow.jar.hasSession()).toBe(true);
  expect(
    (
      await first.getSession(
        new Request(`${origin}/app`, { headers: recovered.flow.jar.headers() }),
      )
    ).session!.user.id,
  ).toBe(persistedUser!.id);
  expect(
    (await bindings.AUTH_DB.prepare("SELECT id FROM user").all()).results,
  ).toHaveLength(1);
  expect(
    (await bindings.AUTH_DB.prepare("SELECT id FROM account").all()).results,
  ).toHaveLength(1);
});

it("an invalid OAuth state cannot reserve or redeem a provider code", async () => {
  const auth = await setup();
  const provider = fakeGitHub();
  const flow = await begin(auth);
  provider.authorize(
    "review_invalid_state",
    { id: 91008, email: "review-state@example.invalid" },
    flow.authorizationURL,
  );
  const original = callback(flow, "review_invalid_state");
  const url = new URL(original.url);
  url.searchParams.set("state", "synthetic_forged_state");
  const result = await auth.handleAuthRequest(
    new Request(url, { headers: original.headers }),
  );
  expect(result.headers.get("Location")).not.toBe(`${origin}/app`);
  expect(
    result.headers
      .getSetCookie()
      .some((cookie) => cookie.includes("session_token=")),
  ).toBe(false);
  expect(provider.exchanges).toBe(0);
  expect(
    (await bindings.AUTH_DB.prepare("SELECT id FROM user").all()).results,
  ).toHaveLength(0);
  expect(
    (
      await bindings.AUTH_DB.prepare(
        "SELECT fingerprint FROM github_code_redemption",
      ).all()
    ).results,
  ).toHaveLength(0);
});

it("interrupted account creation grants no authority and a fresh OAuth recovers the same user", async () => {
  const auth = await setup();
  const provider = fakeGitHub();
  await bindings.AUTH_DB.prepare(
    "CREATE TRIGGER review_interrupt_account BEFORE INSERT ON account BEGIN SELECT RAISE(ABORT,'review_interrupt_account'); END",
  ).run();
  const interrupted = await login(auth, provider, "review_interrupted", {
    id: 91003,
    email: "review-interrupted@example.invalid",
  });
  expect(interrupted.flow.jar.hasSession()).toBe(false);
  expect(
    (await bindings.AUTH_DB.prepare("SELECT id FROM user").all()).results,
  ).toHaveLength(1);
  expect(
    (await bindings.AUTH_DB.prepare("SELECT id FROM account").all()).results,
  ).toHaveLength(0);
  expect(
    (await bindings.AUTH_DB.prepare("SELECT id FROM session").all()).results,
  ).toHaveLength(0);
  const oldIdentity = await bindings.AUTH_DB.prepare(
    "SELECT id FROM user",
  ).first<{ id: string }>();
  expect(
    (
      await auth.getSession(
        new Request(`${origin}/app`, {
          headers: interrupted.flow.jar.headers(),
        }),
      )
    ).session,
  ).toBeNull();
  expect(
    (await bindings.AUTH_DB.prepare("SELECT id FROM workspace").all()).results,
  ).toHaveLength(0);
  await bindings.AUTH_DB.prepare("DROP TRIGGER review_interrupt_account").run();
  const recovered = await login(auth, provider, "review_fresh", {
    id: 91003,
    email: "review-interrupted@example.invalid",
  });
  expect(recovered.flow.jar.hasSession()).toBe(true);
  expect(
    (
      await auth.getSession(
        new Request(`${origin}/app`, { headers: recovered.flow.jar.headers() }),
      )
    ).session?.user.id,
  ).toBe(oldIdentity!.id);
  expect(
    (await bindings.AUTH_DB.prepare("SELECT id FROM user").all()).results,
  ).toHaveLength(1);
  expect(
    (await bindings.AUTH_DB.prepare("SELECT id FROM account").all()).results,
  ).toHaveLength(1);
  expect(provider.exchanges).toBe(2);
});

it.each([
  { localVerified: false, providerVerified: true },
  { localVerified: true, providerVerified: false },
])(
  "email linking is denied with a missing verification: %j",
  async ({ localVerified, providerVerified }) => {
    const auth = await setup();
    const provider = fakeGitHub();
    const now = Date.now();
    await bindings.AUTH_DB.prepare(
      "INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES ('review_existing','Synthetic existing','review-link@example.invalid',?,?,?)",
    )
      .bind(Number(localVerified), now, now)
      .run();
    const result = await login(auth, provider, "review_unverified", {
      id: 91004,
      email: "review-link@example.invalid",
      verified: providerVerified,
    });
    expect(result.flow.jar.hasSession()).toBe(false);
    expect(
      (await bindings.AUTH_DB.prepare("SELECT id FROM account").all()).results,
    ).toHaveLength(0);
    expect(
      (await bindings.AUTH_DB.prepare("SELECT id FROM session").all()).results,
    ).toHaveLength(0);
    expect(
      (await bindings.AUTH_DB.prepare("SELECT id FROM user").all()).results,
    ).toEqual([{ id: "review_existing" }]);
  },
);

it("a surviving session without a linked GitHub account has no admitted identity", async () => {
  const auth = await setup();
  const provider = fakeGitHub();
  const result = await login(auth, provider, "review_orphan_session", {
    id: 91005,
    email: "review-orphan@example.invalid",
  });
  expect(result.flow.jar.hasSession()).toBe(true);
  await bindings.AUTH_DB.prepare("DELETE FROM account").run();
  expect(
    (await bindings.AUTH_DB.prepare("SELECT id FROM session").all()).results,
  ).toHaveLength(1);
  const request = new Request(`${origin}/api/auth/session`, {
    headers: result.flow.jar.headers(),
  });
  expect(await (await auth.handleAuthRequest(request)).json()).toBeNull();
  expect((await auth.getSession(request)).session).toBeNull();
});

it("verified email linking preserves account identity after email changes to another user's address", async () => {
  const auth = await setup();
  const provider = fakeGitHub();
  const original = await login(auth, provider, "review_original", {
    id: 91006,
    email: "review-identity@example.invalid",
  });
  const userId = (
    await auth.getSession(
      new Request(`${origin}/app`, { headers: original.flow.jar.headers() }),
    )
  ).session!.user.id;
  const linked = await login(auth, provider, "review_linked", {
    id: 91007,
    email: "review-identity@example.invalid",
  });
  expect(
    (
      await auth.getSession(
        new Request(`${origin}/app`, { headers: linked.flow.jar.headers() }),
      )
    ).session!.user.id,
  ).toBe(userId);
  const now = Date.now();
  await bindings.AUTH_DB.prepare(
    "INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES ('review_other','Synthetic other','review-other-email@example.invalid',1,?,?)",
  )
    .bind(now, now)
    .run();
  const changed = await login(auth, provider, "review_changed_email", {
    id: 91006,
    email: "review-other-email@example.invalid",
  });
  expect(
    (
      await auth.getSession(
        new Request(`${origin}/app`, { headers: changed.flow.jar.headers() }),
      )
    ).session!.user.id,
  ).toBe(userId);
  expect(
    (
      await bindings.AUTH_DB.prepare(
        "SELECT accountId,userId FROM account ORDER BY accountId",
      ).all()
    ).results,
  ).toEqual([
    { accountId: "91006", userId },
    { accountId: "91007", userId },
  ]);
  expect(
    (await bindings.AUTH_DB.prepare("SELECT id FROM user ORDER BY id").all())
      .results,
  ).toHaveLength(2);
  expect(
    await bindings.AUTH_DB.prepare(
      "SELECT email FROM user WHERE id='review_other'",
    ).first(),
  ).toEqual({ email: "review-other-email@example.invalid" });
});

it("an oversized anonymous sign-in body is rejected before creating OAuth state", async () => {
  const auth = await setup();
  const body = JSON.stringify({
    provider: "github",
    callbackURL: `${origin}/app?query=${"x".repeat(20_000)}`,
    disableRedirect: true,
  });
  const response = await auth.handleAuthRequest(
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body,
    }),
  );
  expect(response.status).toBe(413);
  expect(
    (await bindings.AUTH_DB.prepare("SELECT id FROM verification").all())
      .results,
  ).toHaveLength(0);
});

it("native endpoints outside the Holon allowlist and cross-origin mutations never perform egress", async () => {
  const auth = await setup();
  const provider = fakeGitHub();
  for (const [method, path] of [
    ["GET", "/api/auth/get-session"],
    ["POST", "/api/auth/get-access-token"],
    ["POST", "/api/auth/link-social"],
    ["GET", "/api/auth/callback/google"],
    ["PUT", "/api/auth/sign-in/social"],
  ] as const) {
    const response = await auth.handleAuthRequest(
      new Request(`${origin}${path}`, { method }),
    );
    expect(response.status).toBe(404);
  }
  const forbidden = await auth.handleAuthRequest(
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: {
        Origin: "https://foreign.invalid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ provider: "github" }),
    }),
  );
  expect(forbidden.status).toBe(403);
  expect(provider.exchanges).toBe(0);
});
