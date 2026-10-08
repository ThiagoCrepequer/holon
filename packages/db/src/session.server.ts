import type {
  AdmittedUser,
  DeviceBrowserLabel,
  SessionDeviceDto,
} from "@holon/contracts/dashboard";

import { TenancyError } from "./tenancy-error.server.js";

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
  ): Promise<SessionDeviceDto[]>;
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
    ): Promise<SessionDeviceDto[]> {
      const result = await database
        .prepare(
          "SELECT id, createdAt, expiresAt, userAgent FROM session WHERE userId = ? AND expiresAt > ? ORDER BY createdAt DESC",
        )
        .bind(userId, now)
        .all<{
          id: string;
          createdAt: number | string;
          expiresAt: number | string;
          userAgent: string | null;
        }>();

      return (result.results ?? []).map((row) => ({
        id: row.id,
        createdAt: new Date(row.createdAt).toISOString(),
        expiresAt: new Date(row.expiresAt).toISOString(),
        isCurrent: row.id === currentSessionId,
        label: parseDeviceBrowserLabel(row.userAgent),
      }));
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
          "UPDATE session SET expiresAt = ?, updatedAt = ? WHERE id = ? AND userId = ? AND expiresAt > ? AND expiresAt > CAST(unixepoch('subsec') * 1000 AS INTEGER) AND expiresAt < ?",
        )
        .bind(
          newExpiresAtMs,
          newUpdatedAtMs,
          sessionId,
          userId,
          now,
          newExpiresAtMs,
        )
        .run();

      if ((updateResult.meta?.changes ?? 0) > 0) {
        return { status: "renewed" };
      }

      const current = await database
        .prepare(
          "SELECT expiresAt, updatedAt FROM session WHERE id = ? AND userId = ?",
        )
        .bind(sessionId, userId)
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

      if (currentExpiresAtMs >= newExpiresAtMs) {
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
