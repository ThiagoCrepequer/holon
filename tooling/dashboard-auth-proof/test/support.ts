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

export function fakeGitHub(options: { enforcePkceDowngrade?: boolean } = {}) {
  const codes = new Map<
    string,
    { identity: GitHubIdentity; authorizationURL: URL }
  >();
  const tokenRequests: {
    code: string;
    verifier: string | null;
    clientId: string | null;
    redirectURI: string | null;
  }[] = [];
  let acceptedExchanges = 0;
  let rejectedPkce = 0;
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
      const grant = codes.get(code);
      const verifier = body.get("code_verifier");
      const clientId = body.get("client_id");
      const redirectURI = body.get("redirect_uri");
      tokenRequests.push({
        code,
        verifier: typeof verifier === "string" ? verifier : null,
        clientId: typeof clientId === "string" ? clientId : null,
        redirectURI: typeof redirectURI === "string" ? redirectURI : null,
      });
      if (!grant || consumed.has(code))
        return Response.json({ error: "bad_verification_code" });
      const params = grant.authorizationURL.searchParams;
      if (
        body.get("client_id") !== params.get("client_id") ||
        body.get("client_secret") !== "synthetic-client-secret" ||
        body.get("redirect_uri") !== params.get("redirect_uri")
      )
        return Response.json({ error: "bad_verification_code" });
      const expectedChallenge = params.get("code_challenge");
      if (expectedChallenge) {
        const validFormat =
          typeof verifier === "string" &&
          /^[A-Za-z0-9._~-]{43,128}$/.test(verifier);
        const hash = validFormat
          ? new Uint8Array(
              await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(verifier),
              ),
            )
          : null;
        const derived = hash
          ? btoa(String.fromCharCode(...hash))
              .replaceAll("+", "-")
              .replaceAll("/", "_")
              .replace(/=+$/, "")
          : null;
        if (
          params.get("code_challenge_method") !== "S256" ||
          derived !== expectedChallenge
        ) {
          rejectedPkce += 1;
          return Response.json({ error: "bad_verification_code" });
        }
      } else if (verifier !== null && options.enforcePkceDowngrade !== false) {
        // RFC 9700 section 4.8.2 server obligation, not an observed remote GitHub result.
        rejectedPkce += 1;
        return Response.json({ error: "bad_verification_code" });
      }
      // Model a server's atomic single-use claim AFTER async cryptographic validation.
      // No await may separate this check and add; this is only the external provider fixture.
      if (consumed.has(code))
        return Response.json({ error: "bad_verification_code" });
      consumed.add(code);
      acceptedExchanges += 1;
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
    authorize(code: string, identity: GitHubIdentity, authorizationURL: URL) {
      codes.set(code, {
        identity,
        authorizationURL: new URL(authorizationURL),
      });
    },
    get tokenRequests() {
      return tokenRequests;
    },
    get acceptedExchanges() {
      return acceptedExchanges;
    },
    get rejectedPkce() {
      return rejectedPkce;
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
  const authorizationURL = new URL(payload.url);
  const state = authorizationURL.searchParams.get("state");
  if (!state) throw new Error("Native OAuth did not issue state");
  return { jar, state, authorizationURL, initialHeaders: jar.headers() };
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
  const flow = await beginOAuth(auth);
  github.authorize(code, identity, flow.authorizationURL);
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
