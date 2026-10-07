import { env, reset, type D1Migration } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { validateGitHubAuthConfig } from "../src/server.js";
import {
  beginOAuth,
  completeOAuth,
  fakeGitHub,
  setupAuthService,
  testOrigin,
} from "./support.js";

const bindings = env as unknown as {
  AUTH_DB: D1Database;
  AUTH_MIGRATIONS: D1Migration[];
};

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

const syntheticPerson = {
  id: 4242,
  email: "developer@example.invalid",
  verified: true,
};

describe("GitHub App configuration (#139)", () => {
  it("validates local development configuration and derives exact callback", () => {
    const config = validateGitHubAuthConfig({
      clientId: "dev-client-id",
      clientSecret: "dev-client-secret",
      appOrigin: "http://127.0.0.1:8794",
      environment: "development",
    });
    expect(config.appOrigin).toBe("http://127.0.0.1:8794");
    expect(config.environment).toBe("development");
    expect(config.clientId).toBe("dev-client-id");
    expect(config.clientSecret).toBe("dev-client-secret");
  });

  it("rejects non-loopback origins for development environment", () => {
    expect(() =>
      validateGitHubAuthConfig({
        clientId: "dev-client",
        clientSecret: "dev-secret",
        appOrigin: "https://remote.example.invalid",
        environment: "development",
      }),
    ).toThrow("development environment must use local loopback origin");
  });

  it("rejects invalid URLs with credentials, path, query, or hash", () => {
    for (const badOrigin of [
      "http://user:pass@127.0.0.1:8794",
      "http://127.0.0.1:8794/path",
      "http://127.0.0.1:8794?query=1",
      "http://127.0.0.1:8794#hash",
      "not-a-url",
    ]) {
      expect(() =>
        validateGitHubAuthConfig({
          clientId: "dev-client",
          clientSecret: "dev-secret",
          appOrigin: badOrigin,
          environment: "development",
        }),
      ).toThrow();
    }
  });

  it("fails when preview or production environments are not homologated per operations reference", () => {
    for (const envName of ["preview", "production"] as const) {
      expect(() =>
        validateGitHubAuthConfig({
          clientId: "client-id",
          clientSecret: "client-secret",
          appOrigin: "https://example.invalid",
          environment: envName,
        }),
      ).toThrow(
        /not yet homologated or provisioned with registered origins; see docs\/operations\/dashboard-environments-and-recovery\.md/u,
      );
    }
  });

  it("accepts homologated origins when explicitly provided for remote environments", () => {
    const homologated = new Map([
      ["preview" as const, ["https://preview-dash.example.invalid"]],
      ["production" as const, ["https://dash.example.invalid"]],
    ]);

    const previewConfig = validateGitHubAuthConfig({
      clientId: "preview-id",
      clientSecret: "preview-secret",
      appOrigin: "https://preview-dash.example.invalid",
      environment: "preview",
      homologatedOrigins: homologated,
    });
    expect(previewConfig.environment).toBe("preview");

    const prodConfig = validateGitHubAuthConfig({
      clientId: "prod-id",
      clientSecret: "prod-secret",
      appOrigin: "https://dash.example.invalid",
      environment: "production",
      homologatedOrigins: homologated,
    });
    expect(prodConfig.environment).toBe("production");
  });

  it("fails fast if auth secret is less than 32 characters", async () => {
    await expect(setupAuthService({ authSecret: "too-short" })).rejects.toThrow(
      "authSecret must be at least 32 characters",
    );
  });
});

describe("packages/auth service, strict allowlist, and single-use code redemption (#140)", () => {
  it("signs up by GitHub OAuth, encrypts tokens, and sets secure cookies", async () => {
    const auth = await setupAuthService();
    const github = fakeGitHub();

    const flow = await beginOAuth(auth);
    github.authorize("code-signup", syntheticPerson, flow.authorizationURL);

    const loginResponse = await completeOAuth(auth, flow, "code-signup");
    expect(loginResponse.status).toBe(302);
    expect(flow.jar.hasSession()).toBe(true);

    const cookieHeaders = loginResponse.headers.getSetCookie();
    const sessionCookie = cookieHeaders.find((c) =>
      c.includes("session_token="),
    );
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("Secure");
    expect(sessionCookie).toContain("SameSite=Lax");
    expect(sessionCookie).not.toContain("Domain=");

    // Verify token encryption in D1
    const accountRow = await bindings.AUTH_DB.prepare(
      "SELECT accessToken, refreshToken FROM account WHERE accountId = ?",
    )
      .bind(String(syntheticPerson.id))
      .first<{ accessToken: string; refreshToken: string }>();

    expect(accountRow).toBeDefined();
    expect(accountRow?.accessToken).toBeDefined();
    expect(accountRow?.accessToken).not.toBe("synthetic-access-code-signup");
    expect(accountRow?.refreshToken).not.toBe("synthetic-refresh-code-signup");
  });

  it("rejects replayed code and does not invoke the provider twice", async () => {
    const auth = await setupAuthService();
    const github = fakeGitHub();

    const flow = await beginOAuth(auth);
    github.authorize("code-single-use", syntheticPerson, flow.authorizationURL);

    const first = await completeOAuth(auth, flow, "code-single-use");
    expect(first.status).toBe(302);
    expect(github.exchanges).toBe(1);

    // Attempt replay with original headers
    const replay = await completeOAuth(
      auth,
      flow,
      "code-single-use",
      flow.initialHeaders,
    );
    expect(replay.headers.get("Location")).not.toBe(`${testOrigin}/signed-in`);
    expect(github.exchanges).toBe(1); // Provider was NOT called a second time
  });

  it("sanitizes public session DTO and strips all secret tokens", async () => {
    const auth = await setupAuthService();
    const github = fakeGitHub();

    const flow = await beginOAuth(auth);
    github.authorize("code-sanitized", syntheticPerson, flow.authorizationURL);
    await completeOAuth(auth, flow, "code-sanitized");

    const sessionResponse = await auth.handleAuthRequest(
      new Request(`${testOrigin}/api/auth/session`, {
        headers: flow.jar.headers(),
      }),
    );
    expect(sessionResponse.status).toBe(200);
    expect(sessionResponse.headers.get("Cache-Control")).toBe(
      "private, no-store",
    );

    const bodyText = await sessionResponse.text();
    expect(bodyText).not.toContain("token");
    expect(bodyText).not.toContain("synthetic-access");
    expect(bodyText).not.toContain(syntheticPerson.email);

    const parsed = JSON.parse(bodyText);
    expect(parsed).toMatchObject({
      user: {
        id: expect.any(String),
        name: "Synthetic person",
      },
      session: {
        id: expect.any(String),
        expiresAt: expect.any(String),
      },
    });
  });

  it("denies admitted status and session to orphaned User/Session without linked Account", async () => {
    const auth = await setupAuthService();
    const github = fakeGitHub();

    const flow = await beginOAuth(auth);
    github.authorize("code-orphan", syntheticPerson, flow.authorizationURL);
    await completeOAuth(auth, flow, "code-orphan");

    // Admitted before deletion
    const beforeAdmitted = await auth.getAdmittedUser(
      new Request(`${testOrigin}/api/auth/session`, {
        headers: flow.jar.headers(),
      }),
    );
    expect(beforeAdmitted.user).not.toBeNull();
    expect(beforeAdmitted.user?.githubAccountId).toBe(
      String(syntheticPerson.id),
    );

    // Delete account to simulate orphaned user/session
    await bindings.AUTH_DB.prepare("DELETE FROM account").run();

    const afterSession = await auth.getSession(
      new Request(`${testOrigin}/api/auth/session`, {
        headers: flow.jar.headers(),
      }),
    );
    expect(afterSession.session).toBeNull();

    const afterAdmitted = await auth.getAdmittedUser(
      new Request(`${testOrigin}/api/auth/session`, {
        headers: flow.jar.headers(),
      }),
    );
    expect(afterAdmitted.user).toBeNull();

    const publicSession = await auth.handleAuthRequest(
      new Request(`${testOrigin}/api/auth/session`, {
        headers: flow.jar.headers(),
      }),
    );
    expect(await publicSession.json()).toBeNull();
  });

  it("denies unexpected paths, methods, origins, and malformed bodies", async () => {
    const auth = await setupAuthService();

    // Mismatched origin on social sign in
    const crossOrigin = await auth.handleAuthRequest(
      new Request(`${testOrigin}/api/auth/sign-in/social`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.invalid",
        },
        body: JSON.stringify({ provider: "github" }),
      }),
    );
    expect(crossOrigin.status).toBe(403);

    // Mismatched origin on sign out
    const crossOriginSignOut = await auth.handleAuthRequest(
      new Request(`${testOrigin}/api/auth/sign-out`, {
        method: "POST",
        headers: { Origin: "https://evil.invalid" },
      }),
    );
    expect(crossOriginSignOut.status).toBe(403);

    // Unknown fields or non-github provider
    for (const badBody of [
      "not-json",
      "null",
      "{}",
      JSON.stringify({ provider: "google" }),
      JSON.stringify({ provider: "github", extraField: "leak" }),
    ]) {
      const response = await auth.handleAuthRequest(
        new Request(`${testOrigin}/api/auth/sign-in/social`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: testOrigin,
          },
          body: badBody,
        }),
      );
      expect(response.status).toBe(400);
    }

    // Disallowed paths / methods
    for (const path of [
      "/api/auth/get-session",
      "/api/auth/list-sessions",
      "/api/auth/link-social",
      "/api/auth/unknown",
    ]) {
      for (const method of ["GET", "POST"]) {
        const response = await auth.handleAuthRequest(
          new Request(`${testOrigin}${path}`, { method }),
        );
        expect(response.status).toBe(404);
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      }
    }

    // Request with different URL origin
    const wrongUrl = await auth.handleAuthRequest(
      new Request("https://other.invalid/api/auth/session"),
    );
    expect(wrongUrl.status).toBe(404);
  });

  it("signs out and clears session via POST /api/auth/sign-out", async () => {
    const auth = await setupAuthService();
    const github = fakeGitHub();

    const flow = await beginOAuth(auth);
    github.authorize("code-signout", syntheticPerson, flow.authorizationURL);
    await completeOAuth(auth, flow, "code-signout");

    const signOutResponse = await auth.handleAuthRequest(
      new Request(`${testOrigin}/api/auth/sign-out`, {
        method: "POST",
        headers: {
          Origin: testOrigin,
          ...Object.fromEntries(flow.jar.headers()),
        },
      }),
    );
    expect(signOutResponse.headers.get("Cache-Control")).toBe(
      "private, no-store",
    );

    // Session deleted in D1
    const sessions = await bindings.AUTH_DB.prepare(
      "SELECT * FROM session",
    ).all();
    expect(sessions.results).toHaveLength(0);
  });

  it("prunes expired codes via maintenance method", async () => {
    const auth = await setupAuthService();
    await expect(auth.pruneExpiredCodes()).resolves.toBeUndefined();
  });
});
