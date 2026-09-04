import { createRequestHandler, RouterContextProvider } from "react-router";

import { adminRequestContext } from "../app/server/request-context.js";
import type { AdminEnv } from "./app.js";
import {
  AccessAuthError,
  type AccessIdentity,
  type AccessValidationConfig,
  validateAccessJwt,
} from "./security/access-jwt.js";
import { applySecurityHeaders, generateCspNonce } from "./security/csp.js";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
);

export function isLocalDevelopment(request: Request, env: AdminEnv): boolean {
  if (env.DEV_BYPASS_AUTH !== "true") {
    return false;
  }
  try {
    const { hostname } = new URL(request.url);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

export async function handleConsoleRequest(
  request: Request,
  env: AdminEnv,
  ctx: ExecutionContext,
  authConfigOverride?: AccessValidationConfig,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health") {
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/json; charset=utf-8",
      },
    });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Console is read-only." }),
      {
        status: 405,
        headers: {
          allow: "GET, HEAD",
          "cache-control": "private, no-store",
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  }

  const authConfig = authConfigOverride ?? {
    teamName: env.ACCESS_TEAM_NAME ?? "",
    expectedAudience: env.ACCESS_AUD ?? "",
    authorizedEmailDomain: env.AUTHORIZED_EMAIL_DOMAIN ?? "",
  };
  const isDev = isLocalDevelopment(request, env);
  try {
    let identity: AccessIdentity;
    if (
      isDev &&
      !authConfigOverride &&
      !request.headers.get("cf-access-jwt-assertion")
    ) {
      identity = {
        email: env.DEV_USER_EMAIL ?? "operator@holon.internal",
        sub: "local-dev-operator",
      };
    } else {
      identity = await validateAccessJwt(request, authConfig);
    }
    const nonce = generateCspNonce();
    const loadContext = new RouterContextProvider();
    loadContext.set(adminRequestContext, {
      env,
      executionContext: ctx,
      identity,
      nonce,
    });
    return applySecurityHeaders(
      await requestHandler(request, loadContext),
      nonce,
      { isDev },
    );
  } catch (error) {
    if (error instanceof AccessAuthError) return error.toResponse();
    const nonce = generateCspNonce();
    return applySecurityHeaders(
      new Response("Internal console error", {
        status: 500,
        headers: {
          "cache-control": "private, no-store",
          "content-type": "text/plain; charset=utf-8",
        },
      }),
      nonce,
      { isDev },
    );
  }
}
