import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { vi } from "vitest";

import {
  createAuthService,
  type AuthService,
  type AuthServiceOptions,
} from "../src/server.js";

const bindings = env as unknown as {
  AUTH_DB: D1Database;
  AUTH_MIGRATIONS: D1Migration[];
};

export const testOrigin = "http://127.0.0.1:8794";
export const testSecret =
  "synthetic-auth-secret-for-tests-at-least-32-chars-long";

export async function setupAuthService(
  overrides: Partial<AuthServiceOptions> = {},
): Promise<AuthService> {
  await applyD1Migrations(bindings.AUTH_DB, bindings.AUTH_MIGRATIONS);
  return createAuthService({
    database: bindings.AUTH_DB,
    appOrigin: testOrigin,
    authSecret: testSecret,
    githubClientId: "synthetic-client-id",
    githubClientSecret: "synthetic-client-secret",
    ...overrides,
  });
}

export interface GitHubIdentity {
  readonly id: number;
  readonly email: string;
  readonly verified?: boolean;
}

export function fakeGitHub() {
  const codes = new Map<
    string,
    { identity: GitHubIdentity; authorizationURL: URL; expiresAt: number }
  >();
  const tokenRequests: { code: string; verifier: string | null }[] = [];
  const identities = new Map<string, GitHubIdentity>();
  const consumed = new Set<string>();
  let exchanges = 0;

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);

    if (
      url.href === "https://github.com/login/oauth/access_token" &&
      request.method === "POST"
    ) {
      exchanges += 1;
      const body = await request.formData();
      const codeEntry = body.get("code");
      const code = typeof codeEntry === "string" ? codeEntry : "";
      const grant = codes.get(code);
      const verifier = body.get("code_verifier");

      tokenRequests.push({
        code,
        verifier: typeof verifier === "string" ? verifier : null,
      });

      if (!grant || Date.now() >= grant.expiresAt || consumed.has(code)) {
        return Response.json({ error: "bad_verification_code" });
      }

      const params = grant.authorizationURL.searchParams;
      if (
        body.get("client_id") !== params.get("client_id") ||
        body.get("client_secret") !== "synthetic-client-secret" ||
        body.get("redirect_uri") !== params.get("redirect_uri")
      ) {
        return Response.json({ error: "bad_verification_code" });
      }

      if (consumed.has(code)) {
        return Response.json({ error: "bad_verification_code" });
      }
      consumed.add(code);

      const identity = grant.identity;
      const access = `synthetic-access-${code}`;
      identities.set(access, identity);

      return Response.json({
        access_token: access,
        refresh_token: `synthetic-refresh-${code}`,
        expires_in: 28800,
        refresh_token_expires_in: 15724800,
        token_type: "bearer",
        scope: "",
      });
    }

    const identity = identities.get(
      request.headers.get("Authorization")?.replace(/^Bearer /u, "") ?? "",
    );

    if (
      url.origin === "https://api.github.com" &&
      request.method === "GET" &&
      identity
    ) {
      if (url.pathname === "/user") {
        return Response.json({
          id: identity.id,
          login: `synthetic-${identity.id}`,
          name: "Synthetic person",
          email: null,
          avatar_url: "https://avatars.githubusercontent.com/synthetic",
        });
      }
      if (url.pathname === "/user/emails") {
        return Response.json([
          {
            email: identity.email,
            verified: identity.verified ?? true,
            primary: true,
            visibility: "private",
          },
        ]);
      }
    }

    throw new Error(
      `Unexpected outbound request: network is denied by the test fixture: ${request.url}`,
    );
  });

  return {
    authorize(code: string, identity: GitHubIdentity, authorizationURL: URL) {
      codes.set(code, {
        identity,
        authorizationURL: new URL(authorizationURL),
        expiresAt: Date.now() + 600_000,
      });
    },
    get exchanges() {
      return exchanges;
    },
    get tokenRequests() {
      return tokenRequests;
    },
  };
}

export class CookieJar {
  private readonly values = new Map<string, string>();

  capture(response: Response): void {
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      if (!pair) continue;
      const equals = pair.indexOf("=");
      const name = pair.slice(0, equals);
      const value = pair.slice(equals + 1);
      if (value) this.values.set(name, value);
      else this.values.delete(name);
    }
  }

  headers(): Headers {
    return new Headers({
      Cookie: [...this.values].map(([k, v]) => `${k}=${v}`).join("; "),
    });
  }

  hasSession(): boolean {
    return [...this.values.keys()].some((name) =>
      name.endsWith("session_token"),
    );
  }
}

export async function beginOAuth(
  auth: AuthService,
  jar = new CookieJar(),
  origin = testOrigin,
) {
  const headers = jar.headers();
  headers.set("Content-Type", "application/json");
  headers.set("Origin", origin);

  const response = await auth.handleAuthRequest(
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider: "github",
        callbackURL: `${origin}/signed-in`,
        disableRedirect: true,
      }),
    }),
  );

  if (response.status !== 200) {
    throw new Error(
      `Synthetic OAuth start failed with status ${response.status}`,
    );
  }

  jar.capture(response);
  const payload = (await response.json()) as { url: string };
  const authorizationURL = new URL(payload.url);
  const state = authorizationURL.searchParams.get("state");
  if (!state) throw new Error("Native OAuth did not issue state");

  return { jar, state, authorizationURL, initialHeaders: jar.headers() };
}

export async function completeOAuth(
  auth: AuthService,
  flow: Awaited<ReturnType<typeof beginOAuth>>,
  code: string,
  headers = flow.jar.headers(),
  origin = testOrigin,
) {
  const url = new URL(`${origin}/api/auth/callback/github`);
  url.searchParams.set("state", flow.state);
  url.searchParams.set("code", code);

  const response = await auth.handleAuthRequest(new Request(url, { headers }));
  flow.jar.capture(response);
  return response;
}
