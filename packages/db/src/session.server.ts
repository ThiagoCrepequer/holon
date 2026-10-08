import {
  sessionDeviceListDtoSchema,
  type AdmittedUser,
  type DeviceBrowserLabel,
  type SessionDeviceListDto,
} from "@holon/contracts/dashboard";

import { TenancyError } from "./tenancy-error.server.js";

const SESSION_UPDATE_AGE_MS = 24 * 3600 * 1000;

export function parseDeviceBrowserLabel(
  userAgent: string | null | undefined,
): DeviceBrowserLabel {
  if (!userAgent || typeof userAgent !== "string") {
    return "other";
  }
  if (userAgent.includes("Edg/") || userAgent.includes("Edge/")) {
    return "edge";
  }
  if (userAgent.includes("Chrome/") || userAgent.includes("CriOS/")) {
    return "chrome";
  }
  if (userAgent.includes("Firefox/") || userAgent.includes("FxiOS/")) {
    return "firefox";
  }
  if (
    userAgent.includes("Safari/") &&
    !userAgent.includes("Chrome/") &&
    !userAgent.includes("CriOS/")
  ) {
    return "safari";
  }
  return "other";
}

export type RenewSessionResult =
  | { status: "renewed" }
  | {
      status: "newer_exists";
      current: { expiresAt: number; updatedAt: number };
    }
  | { status: "denied" };

export interface SessionPersistence {
  listSessions(
    userId: string,
    currentSessionId: string,
    now: number,
    cursor?: string,
  ): Promise<SessionDeviceListDto>;
  revokeSession(
    actor: AdmittedUser,
    sessionId: string,
    now?: number,
  ): Promise<boolean>;
  revokeAllSessions(actor: AdmittedUser, now?: number): Promise<number>;
  readSession(
    sessionId: string,
    userId?: string,
  ): Promise<{ expiresAt: number; updatedAt: number } | null>;
  renewSession(
    sessionId: string,
    userId: string,
    now: number,
    newExpiresAtMs: number,
    newUpdatedAtMs: number,
  ): Promise<RenewSessionResult>;
  deleteExpiredSession(
    sessionId: string,
    maxExpiresAt: number,
  ): Promise<boolean>;
  isSessionActive(
    sessionId: string,
    userId: string,
    now?: number,
  ): Promise<boolean>;
}

export function createSessionPersistence(
  database: D1Database,
): SessionPersistence {
  return {
    async listSessions(
      userId: string,
      currentSessionId: string,
      now: number,
      cursor?: string,
    ): Promise<SessionDeviceListDto> {
      const result = await database
        .prepare(
          `WITH admitted_session AS (
             SELECT current.id FROM session current
             WHERE current.id = ?2 AND current.userId = ?1
               AND current.expiresAt > ?3
               AND current.expiresAt > CAST(unixepoch('subsec') * 1000 AS INTEGER)
               AND EXISTS (
                 SELECT 1 FROM account a WHERE a.userId = current.userId AND a.providerId = 'github'
               )
           ), cursor_session AS (
             SELECT id, createdAt FROM session
             WHERE id = ?4 AND userId = ?1 AND expiresAt > ?3
               AND expiresAt > CAST(unixepoch('subsec') * 1000 AS INTEGER)
           ), device_page AS (
             SELECT s.id, s.createdAt, s.expiresAt, s.userAgent FROM session s
             WHERE s.userId = ?1 AND s.expiresAt > ?3
               AND s.expiresAt > CAST(unixepoch('subsec') * 1000 AS INTEGER)
               AND EXISTS (SELECT 1 FROM admitted_session)
               ${cursor ? "AND (s.createdAt, s.id) < (SELECT createdAt, id FROM cursor_session)" : ""}
             ORDER BY s.createdAt DESC, s.id DESC
             LIMIT 101
           )
           SELECT p.id, p.createdAt, p.expiresAt, p.userAgent,
             admitted.id AS current_session_id,
             (SELECT id FROM cursor_session) AS cursor_id
           FROM admitted_session admitted LEFT JOIN device_page p ON 1 = 1
           ORDER BY p.createdAt DESC, p.id DESC`,
        )
        .bind(userId, currentSessionId, now, cursor ?? null)
        .all<{
          id: string | null;
          createdAt: number | string | null;
          expiresAt: number | string | null;
          userAgent: string | null;
          current_session_id: string;
          cursor_id: string | null;
        }>();

      // The left join preserves authority even when the final page is empty;
      // admission, cursor ownership and page rows share one SQLite snapshot.
      const authority = result.results?.[0];
      if (!authority) throw new TenancyError("user_not_admitted");
      if (cursor && authority.cursor_id !== cursor) {
        throw new TenancyError("operation_conflict");
      }
      const rows = result.results.filter((row) => row.id !== null);
      const pageRows = rows.slice(0, 100);
      return sessionDeviceListDtoSchema.parse({
        currentSessionId: authority.current_session_id,
        nextCursor: rows.length > 100 ? pageRows[99]?.id : null,
        sessions: pageRows.map((row) => ({
          id: row.id,
          createdAt: new Date(row.createdAt ?? NaN).toISOString(),
          expiresAt: new Date(row.expiresAt ?? NaN).toISOString(),
          isCurrent: row.id === currentSessionId,
          label: parseDeviceBrowserLabel(row.userAgent),
        })),
      });
    },

    async revokeSession(
      actor: AdmittedUser,
      sessionId: string,
      now = Date.now(),
    ): Promise<boolean> {
      const attemptKey = `att_${crypto.randomUUID().replace(/-/gu, "")}`;
      const batchResults = await database.batch([
        database
          .prepare(
            `INSERT INTO tenancy_mutation_guard (attempt_key, admitted)
             VALUES (?, (
               SELECT CASE WHEN EXISTS (
                 SELECT 1 FROM user u
                 JOIN account a ON a.userId = u.id AND a.providerId = 'github' AND a.accountId = ?
                 JOIN session s ON s.userId = u.id AND s.id = ? AND s.expiresAt > ? AND s.expiresAt > CAST(unixepoch('subsec') * 1000 AS INTEGER)
                 WHERE u.id = ?
               ) THEN 1 ELSE 0 END
             ))`,
          )
          .bind(
            attemptKey,
            actor.githubAccountId,
            actor.sessionId,
            now,
            actor.id,
          ),
        database
          .prepare(
            `DELETE FROM session
             WHERE id = ? AND userId = ?
               AND EXISTS (
                 SELECT 1 FROM tenancy_mutation_guard
                 WHERE attempt_key = ? AND admitted = 1
               )`,
          )
          .bind(sessionId, actor.id, attemptKey),
        database
          .prepare(
            `SELECT admitted FROM tenancy_mutation_guard WHERE attempt_key = ?`,
          )
          .bind(attemptKey),
        database
          .prepare(`DELETE FROM tenancy_mutation_guard WHERE attempt_key = ?`)
          .bind(attemptKey),
      ]);

      const deleteResult = batchResults[1];
      const guardResult = batchResults[2];
      if (!deleteResult || !guardResult) {
        throw new TenancyError("storage_corrupted");
      }

      const admittedRow = guardResult.results?.[0] as
        | { admitted: number }
        | undefined;
      if (admittedRow?.admitted !== 1) {
        throw new TenancyError("user_not_admitted");
      }

      return (deleteResult.meta?.changes ?? 0) > 0;
    },

    async revokeAllSessions(
      actor: AdmittedUser,
      now = Date.now(),
    ): Promise<number> {
      const attemptKey = `att_${crypto.randomUUID().replace(/-/gu, "")}`;
      const batchResults = await database.batch([
        database
          .prepare(
            `INSERT INTO tenancy_mutation_guard (attempt_key, admitted)
             VALUES (?, (
               SELECT CASE WHEN EXISTS (
                 SELECT 1 FROM user u
                 JOIN account a ON a.userId = u.id AND a.providerId = 'github' AND a.accountId = ?
                 JOIN session s ON s.userId = u.id AND s.id = ? AND s.expiresAt > ? AND s.expiresAt > CAST(unixepoch('subsec') * 1000 AS INTEGER)
                 WHERE u.id = ?
               ) THEN 1 ELSE 0 END
             ))`,
          )
          .bind(
            attemptKey,
            actor.githubAccountId,
            actor.sessionId,
            now,
            actor.id,
          ),
        database
          .prepare(
            `DELETE FROM session
             WHERE userId = ?
               AND EXISTS (
                 SELECT 1 FROM tenancy_mutation_guard
                 WHERE attempt_key = ? AND admitted = 1
               )`,
          )
          .bind(actor.id, attemptKey),
        database
          .prepare(
            `SELECT admitted FROM tenancy_mutation_guard WHERE attempt_key = ?`,
          )
          .bind(attemptKey),
        database
          .prepare(`DELETE FROM tenancy_mutation_guard WHERE attempt_key = ?`)
          .bind(attemptKey),
      ]);

      const deleteResult = batchResults[1];
      const guardResult = batchResults[2];
      if (!deleteResult || !guardResult) {
        throw new TenancyError("storage_corrupted");
      }

      const admittedRow = guardResult.results?.[0] as
        | { admitted: number }
        | undefined;
      if (admittedRow?.admitted !== 1) {
        throw new TenancyError("user_not_admitted");
      }

      return deleteResult.meta?.changes ?? 0;
    },

    async readSession(
      sessionId: string,
      userId?: string,
    ): Promise<{ expiresAt: number; updatedAt: number } | null> {
      const query = userId
        ? database
            .prepare(
              "SELECT expiresAt, updatedAt FROM session WHERE id = ? AND userId = ?",
            )
            .bind(sessionId, userId)
        : database
            .prepare("SELECT expiresAt, updatedAt FROM session WHERE id = ?")
            .bind(sessionId);

      const row = await query.first<{
        expiresAt: number | string;
        updatedAt: number | string;
      }>();
      if (!row) return null;
      return {
        expiresAt: new Date(row.expiresAt).getTime(),
        updatedAt: new Date(row.updatedAt).getTime(),
      };
    },

    async renewSession(
      sessionId: string,
      userId: string,
      now: number,
      newExpiresAtMs: number,
      newUpdatedAtMs: number,
    ): Promise<RenewSessionResult> {
      const updateResult = await database
        .prepare(
          "UPDATE session SET expiresAt = ?, updatedAt = ? WHERE id = ? AND userId = ? AND expiresAt > ? AND expiresAt > CAST(unixepoch('subsec') * 1000 AS INTEGER) AND expiresAt <= ?",
        )
        .bind(
          newExpiresAtMs,
          newUpdatedAtMs,
          sessionId,
          userId,
          now,
          newExpiresAtMs - SESSION_UPDATE_AGE_MS,
        )
        .run();

      if ((updateResult.meta?.changes ?? 0) > 0) {
        return { status: "renewed" };
      }

      const current = await database
        .prepare(
          "SELECT expiresAt, updatedAt FROM session WHERE id = ? AND userId = ? AND expiresAt > ? AND expiresAt > CAST(unixepoch('subsec') * 1000 AS INTEGER)",
        )
        .bind(sessionId, userId, now)
        .first<{
          expiresAt: number | string;
          updatedAt: number | string;
        }>();

      if (!current) {
        return { status: "denied" };
      }

      const currentExpiresAtMs = new Date(current.expiresAt).getTime();
      const currentUpdatedAtMs = new Date(current.updatedAt).getTime();
      if (currentExpiresAtMs <= now) {
        return { status: "denied" };
      }

      if (currentExpiresAtMs > newExpiresAtMs - SESSION_UPDATE_AGE_MS) {
        return {
          status: "newer_exists",
          current: {
            expiresAt: currentExpiresAtMs,
            updatedAt: currentUpdatedAtMs,
          },
        };
      }

      return { status: "denied" };
    },

    async deleteExpiredSession(
      sessionId: string,
      maxExpiresAt: number,
    ): Promise<boolean> {
      const result = await database
        .prepare("DELETE FROM session WHERE id = ? AND expiresAt <= ?")
        .bind(sessionId, maxExpiresAt)
        .run();
      return (result.meta?.changes ?? 0) > 0;
    },

    async isSessionActive(
      sessionId: string,
      userId: string,
      now = Date.now(),
    ): Promise<boolean> {
      const row = await database
        .prepare(
          `SELECT 1 FROM session
           WHERE id = ? AND userId = ?
             AND expiresAt > ?
             AND expiresAt > CAST(unixepoch('subsec') * 1000 AS INTEGER)`,
        )
        .bind(sessionId, userId, now)
        .first();
      return Boolean(row);
    },
  };
}
