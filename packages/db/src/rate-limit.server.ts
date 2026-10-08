export interface RateLimitStorage {
  consume(
    key: string,
    rule: { window: number; max: number },
  ): Promise<{ allowed: boolean; retryAfter: number | null }>;
}

export class RateLimitStorageError extends Error {
  constructor(readonly code: string = "storage_unavailable") {
    super("storage_unavailable");
    this.name = "RateLimitStorageError";
  }
}

export async function deriveRateLimitKey(
  namespace: string,
  identifier: string,
  action?: string,
): Promise<string> {
  const payload = action
    ? `${namespace}:${action}:${identifier}`
    : `${namespace}:${identifier}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  const hex = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return `${namespace}:${hex}`;
}

export async function pruneExpiredRateLimits(
  database: D1Database,
  maxAgeSeconds = 3600,
  batchLimit = 100,
): Promise<void> {
  const cutoff = Date.now() - maxAgeSeconds * 1000;
  await database
    .prepare(
      `DELETE FROM rate_limit
       WHERE key IN (
         SELECT key FROM rate_limit
         WHERE window_start < ?1
         LIMIT ?2
       )`,
    )
    .bind(cutoff, batchLimit)
    .run();
}

export function createD1RateLimitStorage(
  database: D1Database,
): RateLimitStorage {
  return {
    async consume(key: string, rule: { window: number; max: number }) {
      if (
        !Number.isFinite(rule.window) ||
        rule.window <= 0 ||
        !Number.isFinite(rule.max) ||
        rule.max <= 0
      ) {
        throw new RateLimitStorageError("invalid_rule");
      }

      const now = Date.now();
      const windowMs = rule.window * 1000;
      // Never store raw IP or user identity: derive hashed key
      const storageKey = await deriveRateLimitKey("rate_limit", key);

      try {
        await pruneExpiredRateLimits(
          database,
          Math.max(3600, rule.window * 2),
          10,
        );
        const result = await database
          .prepare(
            `INSERT INTO rate_limit (key, count, window_start)
             VALUES (?1, 1, ?2)
             ON CONFLICT(key) DO UPDATE SET
               count = CASE
                 WHEN ?2 - rate_limit.window_start >= ?3 THEN 1
                 WHEN rate_limit.count < ?4 THEN rate_limit.count + 1
                 ELSE ?4 + 1
               END,
               window_start = CASE
                 WHEN ?2 - rate_limit.window_start >= ?3 THEN ?2
                 ELSE rate_limit.window_start
               END
             RETURNING count, window_start`,
          )
          .bind(storageKey, now, windowMs, rule.max)
          .first<{ count: number; window_start: number }>();

        if (
          !result ||
          typeof result.count !== "number" ||
          !Number.isFinite(result.count) ||
          result.count < 1 ||
          typeof result.window_start !== "number" ||
          !Number.isFinite(result.window_start) ||
          result.window_start <= 0
        ) {
          throw new RateLimitStorageError("storage_unavailable");
        }

        if (result.count <= rule.max) {
          return { allowed: true, retryAfter: null };
        }

        const elapsedMs = now - result.window_start;
        const remainingMs = Math.max(0, windowMs - elapsedMs);
        const retryAfter = Math.max(1, Math.ceil(remainingMs / 1000));
        return { allowed: false, retryAfter };
      } catch (error) {
        if (error instanceof RateLimitStorageError) {
          throw error;
        }
        throw new RateLimitStorageError("storage_unavailable");
      }
    },
  };
}
