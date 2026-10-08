import {
  applyD1Migrations,
  env,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";

import {
  createD1RateLimitStorage,
  deriveRateLimitKey,
  pruneExpiredRateLimits,
} from "../src/rate-limit.server.js";

const bindings = env as {
  IDENTITY_DB: D1Database;
  IDENTITY_MIGRATIONS: D1Migration[];
};
afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});
async function database() {
  await applyD1Migrations(bindings.IDENTITY_DB, bindings.IDENTITY_MIGRATIONS);
  return bindings.IDENTITY_DB;
}

it("concurrent independent limiter instances admit only the shared durable budget and store no raw identity", async () => {
  const db = await database();
  const raw = "synthetic-actor-private@example.invalid";
  const outcomes = await Promise.all(
    Array.from({ length: 40 }, () =>
      createD1RateLimitStorage(db).consume(raw, { window: 60, max: 7 }),
    ),
  );
  expect(outcomes.filter((x) => x.allowed)).toHaveLength(7);
  for (const result of outcomes.filter((x) => !x.allowed)) {
    expect(result.retryAfter).toBeGreaterThanOrEqual(1);
    expect(result.retryAfter).toBeLessThanOrEqual(60);
  }
  const rows = (
    await db.prepare("SELECT key FROM rate_limit").all<{ key: string }>()
  ).results;
  expect(rows).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toContain(raw);
});

it("a new instance recovers after the window and budgets distinct actors independently", async () => {
  const db = await database();
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const rule = { window: 1, max: 1 };
  expect(
    (await createD1RateLimitStorage(db).consume("actor-one", rule)).allowed,
  ).toBe(true);
  expect(
    (await createD1RateLimitStorage(db).consume("actor-one", rule)).allowed,
  ).toBe(false);
  expect(
    (await createD1RateLimitStorage(db).consume("actor-two", rule)).allowed,
  ).toBe(true);
  now += 1001;
  expect(
    (await createD1RateLimitStorage(db).consume("actor-one", rule)).allowed,
  ).toBe(true);
});

it("namespace and action isolate identities without retaining their raw values", async () => {
  const actor = "synthetic-private-actor";
  const keys = await Promise.all([
    deriveRateLimitKey("actor", actor, "create-team"),
    deriveRateLimitKey("actor", actor, "read"),
    deriveRateLimitKey("workspace", actor, "create-team"),
    deriveRateLimitKey("actor", "other-actor", "create-team"),
  ]);
  expect(new Set(keys).size).toBe(4);
  expect(keys.join(" ")).not.toContain(actor);
  expect(await deriveRateLimitKey("actor", actor, "create-team")).toBe(keys[0]);
});

it("an ambiguous persistence result fails closed as unavailable rather than pretending the budget was exhausted", async () => {
  const db = await database();
  const ambiguous = new Proxy(db, {
    get(target, property) {
      if (property === "prepare")
        return (sql: string) => {
          const statement = target.prepare(sql);
          return new Proxy(statement, {
            get(stmt, name) {
              if (name === "bind")
                return (...values: unknown[]) => {
                  const bound = stmt.bind(...values);
                  return new Proxy(bound, {
                    get(item, method) {
                      if (method === "first") return async () => null;
                      const value = Reflect.get(item, method);
                      return typeof value === "function"
                        ? value.bind(item)
                        : value;
                    },
                  });
                };
              const value = Reflect.get(stmt, name);
              return typeof value === "function" ? value.bind(stmt) : value;
            },
          });
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(
    createD1RateLimitStorage(ambiguous).consume("actor", {
      window: 60,
      max: 1,
    }),
  ).rejects.toThrow();
  expect(
    (await db.prepare("SELECT key FROM rate_limit").all()).results,
  ).toHaveLength(0);
});

it("expired-key maintenance is bounded and preserves active budgets", async () => {
  const db = await database();
  await createD1RateLimitStorage(db).consume("active", { window: 60, max: 1 });
  const old = Date.now() - 3_600_001;
  await db.batch(
    Array.from({ length: 200 }, (_, i) =>
      db
        .prepare(
          "INSERT INTO rate_limit(key,count,window_start) VALUES (?,1,?)",
        )
        .bind(`old_${i}`, old),
    ),
  );
  await pruneExpiredRateLimits(db);
  const remaining = await db
    .prepare("SELECT COUNT(*) AS count FROM rate_limit WHERE key LIKE 'old_%'")
    .first<number>("count");
  expect(remaining).toBeGreaterThanOrEqual(72);
  expect(remaining).toBeLessThan(200);
  expect(
    (
      await createD1RateLimitStorage(db).consume("active", {
        window: 60,
        max: 1,
      })
    ).allowed,
  ).toBe(false);
  await pruneExpiredRateLimits(db);
  expect(
    await db
      .prepare(
        "SELECT COUNT(*) AS count FROM rate_limit WHERE key LIKE 'old_%'",
      )
      .first("count"),
  ).toBe(0);
});

it("corrupt persisted counters do not grant a new request", async () => {
  const db = await database();
  const rule = { window: 60, max: 1 };
  await createD1RateLimitStorage(db).consume("corrupt-actor", rule);
  await db.prepare("UPDATE rate_limit SET count=-50").run();
  await expect(
    createD1RateLimitStorage(db).consume("corrupt-actor", rule),
  ).rejects.toThrow();
});
