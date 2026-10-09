import type { PrivateReviewCorePort } from "@holon/contracts/dashboard-reviews";
import { createProjectionPersistence } from "@holon/db/projection/server";
export { ReviewProjectionWriter } from "./review-projection-writer.js";
export { EmailDeliveryAuthority } from "./email-delivery-authority.js";
import type { EmailDeliveryPort } from "@holon/application/dashboard-ports";

import { publishDueEmail } from "./email-publisher.js";
export { GitHubAccessEvents } from "./github-access-events.js";
import {
  createAuthService,
  createGitHubUserService,
  credentialKeyConfig,
} from "@holon/auth/server";
import {
  authEnabledSchema,
  authEnvironmentSchema,
  authRegisteredOriginsSchema,
  type AuthEnvironment,
} from "@holon/contracts/dashboard";
import { installationIdSchema } from "@holon/contracts/dashboard-collaboration";
import {
  createInvitationPersistence,
  createPreferencesPersistence,
  createTenancyPersistence,
} from "@holon/db/identity/server";
import {
  createRequestHandler,
  RouterContextProvider,
  type ServerBuild,
} from "react-router";

import { nonceContext, viewerServicesContext } from "../app/request-context.js";
import { createWorkspaceCollaboration } from "../app/server/collaboration.server.js";
import { createDashboardHandler } from "../app/server/http-app.server.js";
import {
  errorResponse,
  HttpBoundaryError,
  nonce,
  secureResponse,
} from "../app/server/http-security.server.js";

export interface DashboardWorkerBindings {
  readonly REVIEW_CORE?: PrivateReviewCorePort | undefined;
  readonly EMAIL_DELIVERY?: EmailDeliveryPort | undefined;
  readonly APP_ORIGIN?: string | undefined;
  readonly AUTH_ENVIRONMENT?: string | undefined;
  readonly AUTH_REGISTERED_ORIGINS?: string | undefined;
  readonly AUTH_ENABLED?: string | undefined;
  readonly AUTH_SECRET_VERSIONS?: string | undefined;
  readonly AUTH_SECRET?: string | undefined;
  readonly GITHUB_APP_ID?: string | undefined;
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

const handle = createDashboardHandler((request, requestNonce, services) => {
  const context = new RouterContextProvider();
  context.set(nonceContext, requestNonce);
  context.set(viewerServicesContext, services);
  return render(request, context);
});

export default {
  async scheduled(
    _event: ScheduledController,
    environment: Env,
  ): Promise<void> {
    const env = environment as unknown as DashboardWorkerBindings;
    if (env.IDENTITY_DB)
      await createInvitationPersistence(env.IDENTITY_DB).expireDue();
    if (env.IDENTITY_DB && env.EMAIL_DELIVERY)
      await publishDueEmail(env.IDENTITY_DB, env.EMAIL_DELIVERY);
  },
  async fetch(request: Request, environment: Env): Promise<Response> {
    const requestNonce = nonce();
    try {
      const env = environment as unknown as DashboardWorkerBindings;

      if (!env.APP_ORIGIN || typeof env.APP_ORIGIN !== "string") {
        throw new HttpBoundaryError("unavailable", 503);
      }
      const appOrigin = env.APP_ORIGIN;

      let authEnvironment: AuthEnvironment | undefined;
      if (env.AUTH_ENVIRONMENT !== undefined) {
        const parsedEnv = authEnvironmentSchema.safeParse(env.AUTH_ENVIRONMENT);
        if (!parsedEnv.success) {
          throw new HttpBoundaryError("unavailable", 503);
        }
        authEnvironment = parsedEnv.data;
      }

      let homologatedOrigins:
        | ReadonlyMap<AuthEnvironment, readonly string[]>
        | undefined;
      if (env.AUTH_REGISTERED_ORIGINS !== undefined) {
        let rawJson: unknown;
        try {
          rawJson = JSON.parse(env.AUTH_REGISTERED_ORIGINS);
        } catch {
          throw new HttpBoundaryError("unavailable", 503);
        }
        const parsedOrigins = authRegisteredOriginsSchema.safeParse(rawJson);
        if (!parsedOrigins.success) {
          throw new HttpBoundaryError("unavailable", 503);
        }
        homologatedOrigins = new Map<AuthEnvironment, readonly string[]>([
          ["preview", parsedOrigins.data.preview],
          ["production", parsedOrigins.data.production],
        ]);
      }

      let authEnabled: boolean | undefined;
      if (env.AUTH_ENABLED !== undefined) {
        const parsedEnabled = authEnabledSchema.safeParse(env.AUTH_ENABLED);
        if (!parsedEnabled.success) {
          throw new HttpBoundaryError("unavailable", 503);
        }
        authEnabled = parsedEnabled.data === "true";
      }

      const authSecret = env.AUTH_SECRET;
      const secretVersions: unknown =
        env.AUTH_SECRET_VERSIONS === undefined
          ? undefined
          : JSON.parse(env.AUTH_SECRET_VERSIONS);
      const githubClientId = env.GITHUB_APP_CLIENT_ID;
      const githubClientSecret = env.GITHUB_APP_CLIENT_SECRET;

      let shouldCreateAuth = false;
      if (authEnabled === false) {
        shouldCreateAuth = false;
      } else if (authEnabled === true) {
        const hasAllAuthSecrets = Boolean(
          authSecret && githubClientId && githubClientSecret,
        );
        if (!hasAllAuthSecrets || !env.IDENTITY_DB) {
          throw new HttpBoundaryError("unavailable", 503);
        }
        shouldCreateAuth = true;
      } else {
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

        shouldCreateAuth = hasAllAuthSecrets && Boolean(env.IDENTITY_DB);
      }

      const authService =
        shouldCreateAuth && env.IDENTITY_DB
          ? createAuthService({
              database: env.IDENTITY_DB,
              appOrigin,
              authSecret: authSecret!,
              secretVersions,
              githubClientId: githubClientId!,
              githubClientSecret: githubClientSecret!,
              ...(authEnvironment ? { environment: authEnvironment } : {}),
              ...(homologatedOrigins ? { homologatedOrigins } : {}),
            })
          : undefined;

      const tenancyPersistence =
        shouldCreateAuth && env.IDENTITY_DB
          ? createTenancyPersistence(env.IDENTITY_DB)
          : undefined;

      return await handle(request, appOrigin, {
        authService,
        tenancyPersistence,
        reviewCore: env.REVIEW_CORE,
        reviewProjection:
          env.PROJECTION_DB && authSecret
            ? createProjectionPersistence(env.PROJECTION_DB, authSecret)
            : undefined,
        collaboration:
          shouldCreateAuth && env.IDENTITY_DB && env.GITHUB_APP_ID
            ? createWorkspaceCollaboration(
                env.IDENTITY_DB,
                createGitHubUserService({
                  database: env.IDENTITY_DB,
                  clientId: githubClientId!,
                  clientSecret: githubClientSecret!,
                  appId: installationIdSchema.parse(Number(env.GITHUB_APP_ID)),
                  cryptoKey: credentialKeyConfig(authSecret!, secretVersions)
                    .cryptoKey,
                }),
              )
            : undefined,
        preferencesPersistence:
          shouldCreateAuth && env.IDENTITY_DB
            ? createPreferencesPersistence(env.IDENTITY_DB)
            : undefined,
        authSecret: shouldCreateAuth ? authSecret : undefined,
      });
    } catch (error: unknown) {
      return secureResponse(errorResponse(error), requestNonce);
    }
  },
};
