import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import {
  authSocialSignInInputSchema,
  sessionOutputDtoSchema,
  admittedUserSchema,
  type SessionOutputDto,
  type AdmittedUser,
  type AuthEnvironment,
  type SessionDeviceDto,
} from "@holon/contracts/dashboard";
import { identityAuthSchema } from "@holon/db/auth-integration/server";
import {
  createD1RateLimitStorage,
  createIdentityPersistence,
  type RateLimitStorage,
} from "@holon/db/identity/server";
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/d1";

import { githubCodeRedemptionPlugin } from "./github-code-redemption-plugin.server.js";
import {
  validateGitHubAuthConfig,
  type GitHubAppAuthConfig,
} from "./github-config.server.js";
import { createReauthPlugin } from "./reauth-plugin.server.js";
import {
  createSessionLifecyclePlugin,
  listSessions,
  revokeAllSessions,
  revokeSession,
} from "./session-lifecycle.server.js";

export { validateGitHubAuthConfig, type GitHubAppAuthConfig };

export type AdmittedUserStatus = "admitted" | "disconnected" | "anonymous";

export interface AuthServiceOptions {
  readonly database: D1Database;
  readonly appOrigin: string;
  readonly authSecret: string;
  readonly githubClientId: string;
  readonly githubClientSecret: string;
  readonly environment?: AuthEnvironment;
  readonly homologatedOrigins?: ReadonlyMap<AuthEnvironment, readonly string[]>;
  readonly clock?: (() => number) | undefined;
}
export type { AdmittedUser, RateLimitStorage };

export interface AuthService {
  readonly appOrigin: string;
  readonly rateLimitStorage: RateLimitStorage;
  handleAuthRequest(request: Request): Promise<Response>;
  getSession(request: Request): Promise<{
    session: SessionOutputDto | null;
    headers: Headers;
  }>;
  getAdmittedUser(request: Request): Promise<{
    user: AdmittedUser | null;
    status: AdmittedUserStatus;
    headers: Headers;
  }>;
  listSessions(
    userId: string,
    currentSessionId: string,
  ): Promise<SessionDeviceDto[]>;
  revokeSession(actor: AdmittedUser, sessionId: string): Promise<boolean>;
  revokeAllSessions(actor: AdmittedUser): Promise<number>;
  clearSessionCookies(request: Request): Promise<string[]>;
  pruneExpiredCodes(): Promise<void>;
}

const privateHeaders = { "Cache-Control": "private, no-store" };

async function readBoundedJson(
  request: Request,
  maxBytes = 16_384,
): Promise<
  { ok: true; data: unknown; raw: string } | { ok: false; status: 400 | 413 }
> {
  const lengthHeader = request.headers.get("Content-Length");
  if (lengthHeader && Number(lengthHeader) > maxBytes) {
    return { ok: false, status: 413 };
  }
  if (!request.body) {
    return { ok: false, status: 400 };
  }
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    bytes += result.value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return { ok: false, status: 413 };
    }
    parts.push(result.value);
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  try {
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(merged);
    const data = JSON.parse(raw);
    return { ok: true, data, raw };
  } catch {
    return { ok: false, status: 400 };
  }
}

export function createAuthService(options: AuthServiceOptions): AuthService {
  if (
    typeof options.authSecret !== "string" ||
    options.authSecret.length < 32
  ) {
    throw new Error("authSecret must be at least 32 characters");
  }

  const config = validateGitHubAuthConfig({
    clientId: options.githubClientId,
    clientSecret: options.githubClientSecret,
    appOrigin: options.appOrigin,
    ...(options.environment ? { environment: options.environment } : {}),
    ...(options.homologatedOrigins
      ? { homologatedOrigins: options.homologatedOrigins }
      : {}),
  });

  const rateLimitStorage = createD1RateLimitStorage(options.database);

  const auth = betterAuth({
    baseURL: config.appOrigin,
    secret: options.authSecret,
    database: drizzleAdapter(
      drizzle(options.database, { schema: identityAuthSchema }),
      {
        provider: "sqlite",
        schema: identityAuthSchema,
        transaction: false,
      },
    ),
    plugins: [
      githubCodeRedemptionPlugin(options.database),
      createSessionLifecyclePlugin({
        database: options.database,
        clock: options.clock,
      }),
      createReauthPlugin({
        database: options.database,
      }),
    ],
    socialProviders: {
      github: {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        disableDefaultScope: true,
      },
    },
    account: {
      encryptOAuthTokens: true,
      storeAccountCookie: false,
      accountLinking: { trustedProviders: [] },
    },
    session: {
      expiresIn: 7 * 86400,
      updateAge: 86400,
      cookieCache: { enabled: false },
      deferSessionRefresh: true,
    },
    advanced: {
      useSecureCookies: true,
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
      },
    },
    trustedOrigins: [config.appOrigin],
    logger: { disabled: true },
    rateLimit: {
      enabled: true,
      window: 10,
      max: 100,
      customStorage: rateLimitStorage,
      customRules: {
        "/sign-in/social": { window: 60, max: 10 },
        "/sign-out": { window: 60, max: 30 },
      },
    },
  });

  async function resolveSessionWithAccount(request: Request): Promise<{
    session: SessionOutputDto | null;
    admittedUser: AdmittedUser | null;
    status: AdmittedUserStatus;
    headers: Headers;
  }> {
    const { response: context, headers } = await auth.api.getSession({
      headers: request.headers,
      returnHeaders: true,
    });

    if (!context) {
      return {
        session: null,
        admittedUser: null,
        status: "anonymous",
        headers,
      };
    }

    // Require valid linked GitHub account; an orphaned User/Session is NOT admitted
    const row = await options.database
      .prepare(
        "SELECT accountId FROM account WHERE userId = ? AND providerId = 'github' LIMIT 1",
      )
      .bind(context.user.id)
      .first<{ accountId: string }>();

    if (!row || !row.accountId) {
      return {
        session: null,
        admittedUser: null,
        status: "disconnected",
        headers,
      };
    }

    const output: SessionOutputDto = {
      user: { id: context.user.id, name: context.user.name },
      session: {
        id: context.session.id,
        expiresAt: new Date(context.session.expiresAt).toISOString(),
      },
    };
    sessionOutputDtoSchema.parse(output);

    const admitted: AdmittedUser = {
      id: context.user.id,
      name: context.user.name,
      sessionId: context.session.id,
      expiresAt: new Date(context.session.expiresAt).toISOString(),
      githubAccountId: row.accountId,
    };
    admittedUserSchema.parse(admitted);

    return {
      session: output,
      admittedUser: admitted,
      status: "admitted",
      headers,
    };
  }

  function formatAuthResponse(response: Response): Response {
    if (response.status === 429) {
      const retryAfter =
        response.headers.get("Retry-After") ??
        response.headers.get("X-Retry-After") ??
        "60";
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(privateHeaders)) {
        headers.set(key, value);
      }
      headers.set("Content-Type", "application/json");
      headers.set("Retry-After", retryAfter);
      headers.set("X-Retry-After", retryAfter);
      return new Response(
        JSON.stringify({
          error: {
            code: "rate_limited",
            requestId: crypto.randomUUID(),
          },
        }),
        {
          status: 429,
          headers,
        },
      );
    }
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  return {
    appOrigin: config.appOrigin,
    rateLimitStorage,

    async handleAuthRequest(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (url.origin !== config.appOrigin) {
        return new Response(null, { status: 404, headers: privateHeaders });
      }

      if (request.method === "GET" && url.pathname === "/api/auth/session") {
        const { session, headers } = await resolveSessionWithAccount(request);
        const result = Response.json(session, { headers: privateHeaders });
        for (const cookie of headers.getSetCookie()) {
          result.headers.append("Set-Cookie", cookie);
        }
        return result;
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/auth/sign-in/social"
      ) {
        if (request.headers.get("Origin") !== config.appOrigin) {
          return new Response(null, { status: 403, headers: privateHeaders });
        }

        const secFetchSite = request.headers.get("Sec-Fetch-Site");
        if (secFetchSite === "cross-site" || secFetchSite === "same-site") {
          return new Response(null, { status: 403, headers: privateHeaders });
        }

        const readResult = await readBoundedJson(request);
        if (!readResult.ok) {
          return new Response(null, {
            status: readResult.status,
            headers: privateHeaders,
          });
        }

        const payload = readResult.data;
        const parsed = authSocialSignInInputSchema.safeParse(payload);
        if (!parsed.success) {
          return new Response(null, { status: 400, headers: privateHeaders });
        }

        if (typeof payload === "object" && payload !== null) {
          const allowedKeys = new Set([
            "provider",
            "callbackURL",
            "disableRedirect",
            "reauthIntentId",
          ]);
          if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
            return new Response(null, { status: 400, headers: privateHeaders });
          }
        }

        const callbackURL = parsed.data.callbackURL?.startsWith("/")
          ? `${config.appOrigin}${parsed.data.callbackURL}`
          : parsed.data.callbackURL;

        const authPayload = {
          provider: parsed.data.provider,
          callbackURL,
          disableRedirect: parsed.data.disableRedirect,
          ...(parsed.data.reauthIntentId
            ? { additionalData: { reauthIntentId: parsed.data.reauthIntentId } }
            : {}),
        };

        const freshRequest = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: JSON.stringify(authPayload),
        });

        const response = await auth.handler(freshRequest);
        return formatAuthResponse(response);
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/auth/callback/github"
      ) {
        const response = await auth.handler(request);
        return formatAuthResponse(response);
      }

      if (request.method === "POST" && url.pathname === "/api/auth/sign-out") {
        if (request.headers.get("Origin") !== config.appOrigin) {
          return new Response(null, { status: 403, headers: privateHeaders });
        }

        const secFetchSite = request.headers.get("Sec-Fetch-Site");
        if (secFetchSite === "cross-site" || secFetchSite === "same-site") {
          return new Response(null, { status: 403, headers: privateHeaders });
        }

        const response = await auth.handler(request);
        return formatAuthResponse(response);
      }

      return new Response(null, { status: 404, headers: privateHeaders });
    },

    async getSession(request: Request) {
      const { session, headers } = await resolveSessionWithAccount(request);
      return { session, headers };
    },

    async getAdmittedUser(request: Request) {
      const { admittedUser, status, headers } =
        await resolveSessionWithAccount(request);
      return { user: admittedUser, status, headers };
    },

    async listSessions(userId: string, currentSessionId: string) {
      const now = (options.clock ?? Date.now)();
      return listSessions(options.database, userId, currentSessionId, now);
    },

    async revokeSession(actor: AdmittedUser, sessionId: string) {
      const now = (options.clock ?? Date.now)();
      return revokeSession(options.database, actor, sessionId, now);
    },

    async revokeAllSessions(actor: AdmittedUser) {
      const now = (options.clock ?? Date.now)();
      return revokeAllSessions(options.database, actor, now);
    },

    async clearSessionCookies(request: Request): Promise<string[]> {
      const signOutResponse = await auth.api.signOut({
        headers: request.headers,
        asResponse: true,
      });
      return signOutResponse.headers.getSetCookie();
    },

    async pruneExpiredCodes(): Promise<void> {
      await createIdentityPersistence(
        options.database,
      ).pruneExpiredGithubCodes();
    },
  };
}
