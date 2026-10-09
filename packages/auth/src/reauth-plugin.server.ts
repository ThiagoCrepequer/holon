import {
  createSessionPersistence,
  createTenancyPersistence,
} from "@holon/db/identity/server";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  addOAuthServerContext,
  createAuthMiddleware,
  getOAuthState,
  getSessionFromCtx,
} from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";

export function createReauthPlugin(options: {
  database: D1Database;
}): BetterAuthPlugin {
  const database = options.database;
  const tenancy = createTenancyPersistence(database);
  const sessionPersistence = createSessionPersistence(database);

  return {
    id: "holon-reauth",
    init(context) {
      const github = context.options.socialProviders?.github;
      if (
        !github ||
        typeof github !== "object" ||
        !github.clientId ||
        !Array.isArray(context.socialProviders)
      ) {
        return {};
      }
      return {
        context: {
          socialProviders: context.socialProviders.map((provider) =>
            provider.id !== "github"
              ? provider
              : {
                  ...provider,
                  async refreshAccessToken() {
                    // Native token endpoints are private and refresh writes cannot bypass CAS.
                    throw new APIError("FORBIDDEN", {
                      message: "Use coordinated GitHub credentials",
                    });
                  },
                  async getUserInfo(tokens) {
                    const state = await getOAuthState();
                    const serverContext = state?.serverContext as
                      | {
                          reauthIntentId?: string;
                          originalSessionId?: string;
                          expectedAccountId?: string;
                          userId?: string;
                        }
                      | undefined;
                    const result = await provider.getUserInfo(tokens);
                    if (serverContext?.expectedAccountId) {
                      if (
                        serverContext.originalSessionId &&
                        serverContext.userId
                      ) {
                        const activeOriginal =
                          await sessionPersistence.isSessionActive(
                            serverContext.originalSessionId,
                            serverContext.userId,
                            Date.now(),
                          );

                        if (!activeOriginal) {
                          return null;
                        }
                      }

                      const data = result?.data;
                      const user = result?.user;
                      const dataId =
                        data && typeof data === "object" && "id" in data
                          ? data.id
                          : undefined;
                      const userId =
                        user && typeof user === "object" && "id" in user
                          ? user.id
                          : undefined;
                      const rawSubject = dataId ?? userId;
                      const githubSubject =
                        typeof rawSubject === "string" ||
                        typeof rawSubject === "number"
                          ? String(rawSubject)
                          : "";
                      if (
                        !githubSubject ||
                        githubSubject !== serverContext.expectedAccountId
                      ) {
                        return null;
                      }
                    }
                    return result;
                  },
                },
          ),
        },
      };
    },
    hooks: {
      before: [
        {
          matcher(context) {
            return context.path === "/sign-in/social";
          },
          handler: createAuthMiddleware(async (c) => {
            const body = c.body as
              | {
                  provider?: string;
                  additionalData?: { reauthIntentId?: string };
                }
              | undefined;
            const reauthIntentId = body?.additionalData?.reauthIntentId;
            if (body?.provider === "github" && !reauthIntentId) {
              const caller = await getSessionFromCtx(c, {
                disableCookieCache: true,
                disableRefresh: true,
              });
              if (caller?.session && caller.user) {
                const linked = await database
                  .prepare(
                    "SELECT accountId FROM account WHERE userId=? AND providerId='github'",
                  )
                  .bind(caller.user.id)
                  .first<{ accountId: string }>();
                if (linked)
                  await addOAuthServerContext({
                    expectedAccountId: linked.accountId,
                    originalSessionId: caller.session.id,
                    userId: caller.user.id,
                  });
              }
            }

            if (body?.provider === "github" && reauthIntentId) {
              const callerSession = await getSessionFromCtx(c, {
                disableCookieCache: true,
                disableRefresh: true,
              });
              if (!callerSession?.session || !callerSession?.user) {
                throw new APIError("UNAUTHORIZED", {
                  message: "Authentication required to initiate reauth",
                });
              }

              const pendingContext = await tenancy.readPendingReauthContext(
                reauthIntentId,
                callerSession.session.id,
                callerSession.user.id,
              );

              if (!pendingContext) {
                throw new APIError("UNAUTHORIZED", {
                  message: "Invalid or expired reauth intent",
                });
              }

              await addOAuthServerContext({
                reauthIntentId: pendingContext.reauthIntentId,
                originalSessionId: pendingContext.originalSessionId,
                expectedAccountId: pendingContext.expectedAccountId,
                userId: pendingContext.userId,
              });
            }
            return undefined;
          }),
        },
      ],
      after: [
        {
          matcher(context) {
            return Boolean(context.path?.startsWith("/callback/"));
          },
          handler: createAuthMiddleware(async (ctx) => {
            const state = await getOAuthState();
            const serverContext = state?.serverContext as
              | {
                  reauthIntentId?: string;
                  originalSessionId?: string;
                  expectedAccountId?: string;
                  userId?: string;
                }
              | undefined;

            if (serverContext?.reauthIntentId) {
              const newSession = ctx.context.newSession as
                | {
                    session?: { id: string; token?: string };
                    user?: { id: string };
                  }
                | undefined;

              const sessionId = newSession?.session?.id;
              const userId = newSession?.user?.id;

              let confirmed = false;
              try {
                if (sessionId && userId && serverContext.expectedAccountId) {
                  confirmed = await tenancy.confirmReauthIntent(
                    serverContext.reauthIntentId,
                    serverContext.expectedAccountId,
                    userId,
                    sessionId,
                  );
                }
              } catch {
                confirmed = false;
              }

              if (!confirmed) {
                if (newSession?.session?.token) {
                  deleteSessionCookie(ctx, true);
                  try {
                    await ctx.context.internalAdapter.deleteSession(
                      newSession.session.token,
                    );
                  } catch {
                    // best-effort session deletion on failure
                  }
                  ctx.context.setNewSession(null);
                }
                const defaultErrorURL =
                  ctx.context.options.onAPIError?.errorURL ||
                  `${ctx.context.baseURL}/error`;
                const errorRedirect = `${defaultErrorURL}?error=reauth_failed`;
                throw ctx.redirect(errorRedirect);
              }
            }
            return undefined;
          }),
        },
      ],
    },
  };
}
