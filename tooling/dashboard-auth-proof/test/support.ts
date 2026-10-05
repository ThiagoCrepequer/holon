import { env } from "cloudflare:workers";
import { vi } from "vitest";

import {
  createProofAuth,
  origin,
  type ProofAuth,
  type ProofPersistence,
} from "../src/auth.js";
import { handlePublicAuth } from "../src/public-handler.js";

const definitions = [
  `CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
   emailVerified INTEGER NOT NULL, image TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)`,
  `CREATE TABLE session (id TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL, token TEXT NOT NULL UNIQUE,
   createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, ipAddress TEXT, userAgent TEXT,
   userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE)`,
  `CREATE TABLE account (id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL,
   userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, accessToken TEXT, refreshToken TEXT,
   idToken TEXT, accessTokenExpiresAt INTEGER, refreshTokenExpiresAt INTEGER, scope TEXT, password TEXT,
   createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, UNIQUE(providerId, accountId))`,
  `CREATE TABLE verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL,
   expiresAt INTEGER NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)`,
];

export async function setupAuth(
  persistence: ProofPersistence = "drizzle",
): Promise<ProofAuth> {
  await env.AUTH_DB.batch(definitions.map((sql) => env.AUTH_DB.prepare(sql)));
  return createProofAuth(env.AUTH_DB, persistence);
}

export interface GitHubIdentity {
  id: number;
  email: string;
  verified?: boolean;
}

export function fakeGitHub() {
  const codes = new Map<string, GitHubIdentity>();
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
      const submittedCode = body.get("code");
      const code = typeof submittedCode === "string" ? submittedCode : "";
      const identity = codes.get(code);
      if (!identity || consumed.has(code))
        return Response.json({ error: "bad_verification_code" });
      consumed.add(code);
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
      request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "",
    );
    if (
      url.origin === "https://api.github.com" &&
      request.method === "GET" &&
      identity
    ) {
      if (url.pathname === "/user")
        return Response.json({
          id: identity.id,
          login: `synthetic-${identity.id}`,
          name: "Synthetic person",
          email: null,
          avatar_url: "https://avatars.githubusercontent.com/synthetic",
        });
      if (url.pathname === "/user/emails")
        return Response.json([
          {
            email: identity.email,
            verified: identity.verified ?? true,
            primary: true,
            visibility: "private",
          },
        ]);
    }
    throw new Error(
      "Unexpected outbound request: network is denied by the proof fixture",
    );
  });
  return {
    authorize(code: string, identity: GitHubIdentity) {
      codes.set(code, identity);
    },
    get exchanges() {
      return exchanges;
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

export async function beginOAuth(auth: ProofAuth, jar = new CookieJar()) {
  const headers = jar.headers();
  headers.set("Content-Type", "application/json");
  headers.set("Origin", origin);
  const response = await handlePublicAuth(
    auth,
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
  if (response.status !== 200)
    throw new Error(
      `Synthetic OAuth start failed with status ${response.status}`,
    );
  jar.capture(response);
  const payload = (await response.json()) as { url: string };
  const state = new URL(payload.url).searchParams.get("state");
  if (!state) throw new Error("Native OAuth did not issue state");
  return { jar, state, initialHeaders: jar.headers() };
}

export async function completeOAuth(
  auth: ProofAuth,
  flow: Awaited<ReturnType<typeof beginOAuth>>,
  code: string,
  headers = flow.jar.headers(),
) {
  const url = new URL(`${origin}/api/auth/callback/github`);
  url.searchParams.set("state", flow.state);
  url.searchParams.set("code", code);
  const response = await handlePublicAuth(auth, new Request(url, { headers }));
  flow.jar.capture(response);
  return response;
}

export async function signIn(
  auth: ProofAuth,
  github: ReturnType<typeof fakeGitHub>,
  code: string,
  identity: GitHubIdentity,
) {
  github.authorize(code, identity);
  const flow = await beginOAuth(auth);
  const response = await completeOAuth(auth, flow, code);
  return { response, flow };
}

export async function snapshot() {
  const users = await env.AUTH_DB.prepare(
    "SELECT id,email,emailVerified FROM user ORDER BY id",
  ).all();
  const accounts = await env.AUTH_DB.prepare(
    "SELECT id,accountId,providerId,userId,accessToken,refreshToken FROM account ORDER BY id",
  ).all();
  const sessions = await env.AUTH_DB.prepare(
    "SELECT id,userId,token FROM session ORDER BY id",
  ).all();
  return {
    users: users.results,
    accounts: accounts.results,
    sessions: sessions.results,
  };
}

export async function interruptAccountInsert(): Promise<void> {
  // Fault injection in the actual D1 engine; never used as a recovery mechanism.
  await env.AUTH_DB.prepare(`CREATE TRIGGER synthetic_account_insert_failure BEFORE INSERT ON account
    BEGIN SELECT RAISE(ABORT, 'synthetic_account_insert_failure'); END`).run();
}

export async function interruptedSignupThenNewOAuth(
  persistence: ProofPersistence = "drizzle",
) {
  const auth = await setupAuth(persistence);
  const github = fakeGitHub();
  await interruptAccountInsert();
  const first = await signIn(auth, github, "interrupted", {
    id: 9001,
    email: "person@example.invalid",
  });
  const interrupted = await snapshot();
  await env.AUTH_DB.prepare(
    "DROP TRIGGER synthetic_account_insert_failure",
  ).run();
  const fresh = await signIn(auth, github, "fresh", {
    id: 9001,
    email: "person@example.invalid",
  });
  return { auth, github, first, interrupted, fresh, final: await snapshot() };
}
