import { createAuthService } from "@holon/auth/server";
import { createTenancyPersistence } from "@holon/db/identity/server";
import {
  createRequestHandler,
  RouterContextProvider,
  type ServerBuild,
} from "react-router";

import { nonceContext } from "../app/request-context.js";
import { createDashboardHandler } from "../app/server/http-app.server.js";
import {
  errorResponse,
  HttpBoundaryError,
  nonce,
  secureResponse,
} from "../app/server/http-security.server.js";

export interface DashboardWorkerBindings {
  readonly APP_ORIGIN?: string | undefined;
  readonly AUTH_SECRET?: string | undefined;
  readonly GITHUB_APP_CLIENT_ID?: string | undefined;
  readonly GITHUB_APP_CLIENT_SECRET?: string | undefined;
  readonly IDENTITY_DB?: D1Database | undefined;
  readonly PROJECTION_DB?: D1Database | undefined;
}

const render = createRequestHandler(
  async () => {
    const {
      basename,
      allowedActionOrigins,
      unstable_getCriticalCss,
      ...build
    } = await import("virtual:react-router/server-build");
    // Generated module exports use T | undefined for optional properties.
    // Preserve their absence without weakening exactOptionalPropertyTypes.
    return {
      ...build,
      ...(basename === undefined ? {} : { basename }),
      ...(allowedActionOrigins === undefined ? {} : { allowedActionOrigins }),
      ...(unstable_getCriticalCss === undefined
        ? {}
        : { unstable_getCriticalCss }),
    } satisfies ServerBuild;
  },
  import.meta.env.MODE,
);

const handle = createDashboardHandler((request, requestNonce) => {
  const context = new RouterContextProvider();
  context.set(nonceContext, requestNonce);
  return render(request, context);
});

export default {
  async fetch(request: Request, environment: Env): Promise<Response> {
    const requestNonce = nonce();
    try {
      const env = environment as unknown as DashboardWorkerBindings;

      if (!env.APP_ORIGIN || typeof env.APP_ORIGIN !== "string") {
        throw new HttpBoundaryError("unavailable", 503);
      }
      const appOrigin = env.APP_ORIGIN;

      const authSecret = env.AUTH_SECRET;
      const githubClientId = env.GITHUB_APP_CLIENT_ID;
      const githubClientSecret = env.GITHUB_APP_CLIENT_SECRET;

      const hasAnyAuthSecret = Boolean(
        authSecret || githubClientId || githubClientSecret,
      );
      const hasAllAuthSecrets = Boolean(
        authSecret && githubClientId && githubClientSecret,
      );

      if (hasAnyAuthSecret && !hasAllAuthSecrets) {
        throw new HttpBoundaryError("unavailable", 503);
      }

      if (hasAllAuthSecrets && !env.IDENTITY_DB) {
        throw new HttpBoundaryError("unavailable", 503);
      }

      const authService =
        hasAllAuthSecrets && env.IDENTITY_DB
          ? createAuthService({
              database: env.IDENTITY_DB,
              appOrigin,
              authSecret: authSecret!,
              githubClientId: githubClientId!,
              githubClientSecret: githubClientSecret!,
            })
          : undefined;

      const tenancyPersistence = env.IDENTITY_DB
        ? createTenancyPersistence(env.IDENTITY_DB)
        : undefined;

      return await handle(request, appOrigin, {
        authService,
        tenancyPersistence,
        authSecret,
      });
    } catch (error: unknown) {
      return secureResponse(errorResponse(error), requestNonce);
    }
  },
};
