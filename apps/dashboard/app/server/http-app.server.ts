import type { WorkspaceTenancyPort } from "@holon/application/dashboard-ports";
import type { AuthService } from "@holon/auth/server";
import {
  createTeamWorkspaceInputSchema,
  dashboardIdSchema,
  personalWorkspaceInputSchema,
  type AdmittedUser,
} from "@holon/contracts/dashboard";
import {
  deriveRateLimitKey,
  RateLimitStorageError,
  TenancyError,
  type RateLimitStorage,
} from "@holon/db/identity/server";
import { Hono, type Context } from "hono";

import {
  assertRequestOrigin,
  configuredOrigin,
  errorResponse,
  HttpBoundaryError,
  issueSessionCsrfToken,
  nonce,
  readCommand,
  secureResponse,
} from "./http-security.server.js";

export interface DashboardServices {
  readonly authService?: AuthService | undefined;
  readonly tenancyPersistence?: WorkspaceTenancyPort | undefined;
  readonly authSecret?: string | undefined;
  readonly rateLimitStorage?: RateLimitStorage | undefined;
}

interface ApiEnv {
  services: DashboardServices;
  origin: string;
  sessionCookies: string[];
}

const ALLOWED_MUTATION_PATHS = new Set([
  "/api/auth/sign-in/social",
  "/api/auth/sign-out",
  "/api/workspaces/personal",
  "/api/workspaces/team",
]);

function mapBoundaryError(error: unknown): unknown {
  if (error instanceof TenancyError) {
    if (error.code === "operation_conflict") {
      return new HttpBoundaryError("invalid_request", 409);
    }
    if (error.code === "user_not_admitted") {
      return new HttpBoundaryError("denied", 403);
    }
    if (error.code === "command_unknown") {
      return new HttpBoundaryError("command_unknown", 503);
    }
    return new HttpBoundaryError("unavailable", 503);
  }
  if (error instanceof RateLimitStorageError) {
    return new HttpBoundaryError("unavailable", 503);
  }
  return error;
}

async function requireAdmittedSession(
  request: Request,
  services: DashboardServices,
  sessionCookies: string[],
): Promise<{ user: AdmittedUser; authHeaders: Headers }> {
  if (!services.authService || !services.tenancyPersistence) {
    throw new HttpBoundaryError("unavailable", 503);
  }
  const resolution = await services.authService.getAdmittedUser(request);
  for (const cookie of resolution.headers.getSetCookie()) {
    sessionCookies.push(cookie);
  }
  if (resolution.status === "disconnected") {
    throw new HttpBoundaryError("reconnect_required", 401);
  }
  if (!resolution.user) {
    throw new HttpBoundaryError("denied", 403);
  }
  return { user: resolution.user, authHeaders: resolution.headers };
}

async function requireAdmittedMutation<T>(
  request: Request,
  origin: string,
  services: DashboardServices,
  sessionCookies: string[],
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
  },
): Promise<{ user: AdmittedUser; payload: T; authHeaders: Headers }> {
  if (!services.authSecret) {
    throw new HttpBoundaryError("unavailable", 503);
  }
  const { user, authHeaders } = await requireAdmittedSession(
    request,
    services,
    sessionCookies,
  );
  const csrfToken = await issueSessionCsrfToken(
    user.sessionId,
    services.authSecret,
  );
  const rawPayload = await readCommand(request, origin, {
    sessionId: user.sessionId,
    csrfToken,
  });
  const parsed = schema.safeParse(rawPayload);
  if (!parsed.success) {
    throw new HttpBoundaryError("invalid_request", 400);
  }
  const rateLimiter =
    services.rateLimitStorage ?? services.authService?.rateLimitStorage;
  if (!rateLimiter) {
    throw new HttpBoundaryError("unavailable", 503);
  }
  const rateKey = await deriveRateLimitKey("tenancy", user.id, "mutation");
  const rateResult = await rateLimiter.consume(rateKey, {
    window: 60,
    max: 30,
  });
  if (!rateResult.allowed) {
    throw new HttpBoundaryError(
      "rate_limited",
      429,
      rateResult.retryAfter ?? 60,
    );
  }
  return { user, payload: parsed.data, authHeaders };
}

async function consumeReadRateLimit(
  request: Request,
  services: DashboardServices,
  action: string,
): Promise<void> {
  const rateLimiter =
    services.rateLimitStorage ?? services.authService?.rateLimitStorage;
  if (!rateLimiter) {
    throw new HttpBoundaryError("unavailable", 503);
  }
  const clientIdentifier =
    request.headers.get("cf-connecting-ip")?.trim() || "anonymous";
  const rateKey = await deriveRateLimitKey("read", clientIdentifier, action);
  const rateResult = await rateLimiter.consume(rateKey, {
    window: 60,
    max: 120,
  });
  if (!rateResult.allowed) {
    throw new HttpBoundaryError(
      "rate_limited",
      429,
      rateResult.retryAfter ?? 60,
    );
  }
}

function respondWithCookies(data: unknown, sessionCookies: string[]): Response {
  const response = Response.json(data);
  for (const cookie of sessionCookies) {
    response.headers.append("Set-Cookie", cookie);
  }
  return response;
}

async function handleAuthRequest(
  c: Context<{ Bindings: ApiEnv }>,
): Promise<Response> {
  if (!c.env.services.authService) {
    throw new HttpBoundaryError("invalid_request", 404);
  }
  const pathname = new URL(c.req.raw.url).pathname;
  if (pathname === "/api/auth/session") {
    await consumeReadRateLimit(c.req.raw, c.env.services, pathname);
  }
  const authResponse = await c.env.services.authService.handleAuthRequest(
    c.req.raw,
  );
  if (
    pathname === "/api/auth/session" &&
    authResponse.status === 200 &&
    c.env.services.authSecret
  ) {
    const cloned = authResponse.clone();
    const sessionBody = (await cloned.json().catch(() => null)) as {
      session?: { id?: string };
    } | null;
    if (sessionBody?.session?.id) {
      const csrfToken = await issueSessionCsrfToken(
        sessionBody.session.id,
        c.env.services.authSecret,
      );
      authResponse.headers.set("X-CSRF-Token", csrfToken);
      authResponse.headers.append(
        "Set-Cookie",
        `holon_csrf=${csrfToken}; Path=/; SameSite=Lax; Secure`,
      );
    }
  }
  return authResponse;
}

export function createDashboardHandler(
  render: (request: Request, requestNonce: string) => Promise<Response>,
  defaultServices?: DashboardServices,
) {
  const api = new Hono<{ Bindings: ApiEnv }>();

  api.get("/api/health", (c) => c.json({ status: "ok" }));

  api.post("/api/auth/sign-in/social", async (c) => {
    if (
      ["cross-site", "same-site"].includes(c.req.header("Sec-Fetch-Site") ?? "")
    ) {
      throw new HttpBoundaryError("denied", 403);
    }
    if (
      c.req.header("Content-Type")?.split(";")[0]?.trim() !== "application/json"
    ) {
      throw new HttpBoundaryError("invalid_request", 400);
    }
    return handleAuthRequest(c);
  });

  api.on(["GET", "HEAD"], "/api/auth/sign-out", () => {
    throw new HttpBoundaryError("invalid_request", 405);
  });

  api.post("/api/auth/sign-out", async (c) => {
    if (
      ["cross-site", "same-site"].includes(c.req.header("Sec-Fetch-Site") ?? "")
    ) {
      throw new HttpBoundaryError("denied", 403);
    }
    if (
      c.req.header("Content-Type")?.split(";")[0]?.trim() !== "application/json"
    ) {
      throw new HttpBoundaryError("invalid_request", 400);
    }
    if (!c.env.services.authSecret) {
      throw new HttpBoundaryError("unavailable", 503);
    }
    const { user } = await requireAdmittedSession(
      c.req.raw,
      c.env.services,
      c.env.sessionCookies,
    );
    const csrfToken = await issueSessionCsrfToken(
      user.sessionId,
      c.env.services.authSecret,
    );
    const rawPayload = await readCommand(c.req.raw, c.env.origin, {
      sessionId: user.sessionId,
      csrfToken,
    });
    const parsed = personalWorkspaceInputSchema.safeParse(rawPayload);
    if (!parsed.success) {
      throw new HttpBoundaryError("invalid_request", 400);
    }
    if (!c.env.services.authService) {
      throw new HttpBoundaryError("invalid_request", 404);
    }
    const authReq = new Request(c.req.raw.url, {
      method: "POST",
      headers: c.req.raw.headers,
      body: "{}",
    });
    const authRes = await c.env.services.authService.handleAuthRequest(authReq);
    for (const cookie of c.env.sessionCookies) {
      authRes.headers.append("Set-Cookie", cookie);
    }
    return authRes;
  });

  api.all("/api/auth", handleAuthRequest);
  api.all("/api/auth/*", handleAuthRequest);

  api.get("/api/workspaces", async (c) => {
    await consumeReadRateLimit(c.req.raw, c.env.services, "/api/workspaces");
    const { user } = await requireAdmittedSession(
      c.req.raw,
      c.env.services,
      c.env.sessionCookies,
    );
    const workspaces =
      await c.env.services.tenancyPersistence!.listUserWorkspaces(user.id);
    return respondWithCookies({ workspaces }, c.env.sessionCookies);
  });

  api.post("/api/workspaces/personal", async (c) => {
    const { user } = await requireAdmittedMutation(
      c.req.raw,
      c.env.origin,
      c.env.services,
      c.env.sessionCookies,
      personalWorkspaceInputSchema,
    );
    const result =
      await c.env.services.tenancyPersistence!.provisionPersonalWorkspace(user);
    return respondWithCookies(result, c.env.sessionCookies);
  });

  api.post("/api/workspaces/team", async (c) => {
    const { user, payload } = await requireAdmittedMutation(
      c.req.raw,
      c.env.origin,
      c.env.services,
      c.env.sessionCookies,
      createTeamWorkspaceInputSchema,
    );
    const result = await c.env.services.tenancyPersistence!.createTeamWorkspace(
      user,
      payload,
    );
    return respondWithCookies(result, c.env.sessionCookies);
  });

  api.all("/api/workspaces/leave", () => {
    throw new HttpBoundaryError("invalid_request", 404);
  });

  api.get("/api/workspaces/:id", async (c) => {
    const id = c.req.param("id");
    if (id === "personal" || id === "team") {
      throw new HttpBoundaryError("invalid_request", 405);
    }
    const idParsed = dashboardIdSchema.safeParse(id);
    if (!idParsed.success) {
      throw new HttpBoundaryError("invalid_request", 400);
    }
    const { user } = await requireAdmittedSession(
      c.req.raw,
      c.env.services,
      c.env.sessionCookies,
    );
    await consumeReadRateLimit(c.req.raw, c.env.services, "/api/workspaces");
    const result = await c.env.services.tenancyPersistence!.readWorkspace(
      user.id,
      idParsed.data,
    );
    if (!result) {
      throw new HttpBoundaryError("denied", 404);
    }
    return respondWithCookies(result, c.env.sessionCookies);
  });

  api.notFound((c) => {
    const res = errorResponse(new HttpBoundaryError("invalid_request", 404));
    if (c.env?.sessionCookies) {
      for (const cookie of c.env.sessionCookies) {
        res.headers.append("Set-Cookie", cookie);
      }
    }
    return res;
  });

  api.onError((err, c) => {
    const res = errorResponse(mapBoundaryError(err));
    if (c.env?.sessionCookies) {
      for (const cookie of c.env.sessionCookies) {
        res.headers.append("Set-Cookie", cookie);
      }
    }
    return res;
  });

  return async (
    request: Request,
    appOrigin: string,
    requestServices?: DashboardServices,
  ) => {
    const requestNonce = nonce();
    const services: DashboardServices = {
      ...defaultServices,
      ...requestServices,
    };
    const sessionCookies: string[] = [];

    try {
      const origin = configuredOrigin(appOrigin);
      assertRequestOrigin(request, origin);

      const url = new URL(request.url);
      if (url.search.length > 2_048) {
        throw new HttpBoundaryError("invalid_request", 414);
      }

      if (!url.pathname.startsWith("/api/")) {
        if (!["GET", "HEAD"].includes(request.method)) {
          throw new HttpBoundaryError("invalid_request", 405);
        }
        const response = await render(request, requestNonce);
        return secureResponse(response, requestNonce);
      }

      if (!["GET", "HEAD"].includes(request.method)) {
        if (
          request.method !== "POST" ||
          !ALLOWED_MUTATION_PATHS.has(url.pathname)
        ) {
          throw new HttpBoundaryError("invalid_request", 405);
        }
      }

      const response = await api.fetch(request, {
        services,
        origin,
        sessionCookies,
      });
      return secureResponse(response, requestNonce);
    } catch (error) {
      const errRes = errorResponse(error);
      for (const cookie of sessionCookies) {
        errRes.headers.append("Set-Cookie", cookie);
      }
      return secureResponse(errRes, requestNonce);
    }
  };
}
