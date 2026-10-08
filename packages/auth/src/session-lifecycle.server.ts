import type {
  AdmittedUser,
  SessionDeviceDto,
} from "@holon/contracts/dashboard";
import {
  createSessionPersistence,
  parseDeviceBrowserLabel,
} from "@holon/db/identity/server";
import type { BetterAuthPlugin, Session, User } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie, setSessionCookie } from "better-auth/cookies";

export const EXPIRES_IN_SEC = 7 * 86400;
export const EXPIRES_IN_MS = EXPIRES_IN_SEC * 1000;
export const UPDATE_AGE_MS = 24 * 3600 * 1000;

export { parseDeviceBrowserLabel };

export async function listSessions(
  database: D1Database,
  userId: string,
  currentSessionId: string,
  now: number,
): Promise<SessionDeviceDto[]> {
  return createSessionPersistence(database).listSessions(
    userId,
    currentSessionId,
    now,
  );
}

export async function revokeSession(
  database: D1Database,
  actor: AdmittedUser,
  sessionId: string,
  now = Date.now(),
): Promise<boolean> {
  return createSessionPersistence(database).revokeSession(
    actor,
    sessionId,
    now,
  );
}

export async function revokeAllSessions(
  database: D1Database,
  actor: AdmittedUser,
  now = Date.now(),
): Promise<number> {
  return createSessionPersistence(database).revokeAllSessions(actor, now);
}

export function createSessionLifecyclePlugin(options: {
  database: D1Database;
  clock?: (() => number) | undefined;
}): BetterAuthPlugin {
  const clock = options.clock ?? (() => Date.now());
  const database = options.database;

  return {
    id: "holon-session-lifecycle",
    init() {
      return {
        options: {
          session: {
            deferSessionRefresh: true,
          },
          databaseHooks: {
            session: {
              create: {
                async before(session) {
                  const now = clock();
                  return {
                    data: {
                      ...session,
                      createdAt: new Date(now),
                      updatedAt: new Date(now),
                      expiresAt: new Date(now + EXPIRES_IN_MS),
                    },
                  };
                },
              },
            },
          },
        },
      };
    },
    hooks: {
      before: [
        {
          matcher(context) {
            return context.path === "/get-session";
          },
          handler: createAuthMiddleware(async (c) => {
            return {
              context: {
                query: {
                  ...c.query,
                  disableRefresh: true,
                },
              },
            };
          }),
        },
      ],
      after: [
        {
          matcher(context) {
            return context.path === "/get-session";
          },
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned as {
              session: Session & Record<string, unknown>;
              user: User & Record<string, unknown>;
            } | null;

            const nativeSnapshot = ctx.context.session as
              | {
                  session: Session & Record<string, unknown>;
                  user: User & Record<string, unknown>;
                }
              | null
              | undefined;

            const active = returned?.session
              ? returned
              : nativeSnapshot?.session
                ? nativeSnapshot
                : null;

            if (!active || !active.session) {
              return undefined;
            }

            const sessionPersistence = createSessionPersistence(database);
            const now = clock();
            const expiresAtMs = new Date(active.session.expiresAt).getTime();

            if (now >= expiresAtMs) {
              const deleted = await sessionPersistence.deleteExpiredSession(
                active.session.id,
                now,
              );

              if (!deleted) {
                const current = await sessionPersistence.readSession(
                  active.session.id,
                );

                if (current && current.expiresAt > now) {
                  active.session.expiresAt = new Date(current.expiresAt);
                  active.session.updatedAt = new Date(current.updatedAt);
                  await setSessionCookie(ctx, active, false, {
                    maxAge: EXPIRES_IN_SEC,
                  });
                  return ctx.json(active);
                }
              }

              deleteSessionCookie(ctx);
              return ctx.json(null);
            }

            const shouldRenew =
              now >= expiresAtMs - EXPIRES_IN_MS + UPDATE_AGE_MS;
            if (!shouldRenew) {
              if (!returned?.session) {
                await setSessionCookie(ctx, active, false, {
                  maxAge: EXPIRES_IN_SEC,
                });
                return ctx.json(active);
              }
              return undefined;
            }

            const newExpiresAtMs = now + EXPIRES_IN_MS;
            const newUpdatedAtMs = now;

            const renewalResult = await sessionPersistence.renewSession(
              active.session.id,
              active.user.id,
              now,
              newExpiresAtMs,
              newUpdatedAtMs,
            );

            if (renewalResult.status === "renewed") {
              active.session.expiresAt = new Date(newExpiresAtMs);
              active.session.updatedAt = new Date(newUpdatedAtMs);

              await setSessionCookie(ctx, active, false, {
                maxAge: EXPIRES_IN_SEC,
              });
              return ctx.json(active);
            }

            if (renewalResult.status === "newer_exists") {
              active.session.expiresAt = new Date(
                renewalResult.current.expiresAt,
              );
              active.session.updatedAt = new Date(
                renewalResult.current.updatedAt,
              );
              await setSessionCookie(ctx, active, false, {
                maxAge: EXPIRES_IN_SEC,
              });
              return ctx.json(active);
            }

            deleteSessionCookie(ctx);
            return ctx.json(null);
          }),
        },
      ],
    },
  };
}
