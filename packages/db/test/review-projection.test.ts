import type {
  PrivateReviewSummary,
  ReviewListInput,
} from "@holon/contracts/dashboard-reviews";
import {
  env,
  applyD1Migrations,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { afterEach, beforeEach, expect, it } from "vitest";

import { createProjectionPersistence } from "../src/projection.server.js";
const bindings = env as {
  PROJECTION_DB: D1Database;
  PROJECTION_MIGRATIONS: D1Migration[];
};
const snapshot: PrivateReviewSummary = {
  installationId: 1,
  repositoryId: 2,
  pullRequestNumber: 3,
  title: "Correção Ágil",
  author: "synthetic",
  pullRequestState: "open",
  headSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  runId: null,
  state: "awaiting_review",
  snapshotRevision: 100,
  activityAt: "2026-10-09T00:00:00.000Z",
  observedAt: "2026-10-09T00:00:00.000Z",
};
const input: ReviewListInput = {
  workspaceId: "synthetic",
  installationId: 1,
  repositoryId: 2,
  status: null,
  search: "",
  cursor: null,
  limit: 50,
};
const store = () =>
  createProjectionPersistence(bindings.PROJECTION_DB, "synthetic cursor key");
beforeEach(() =>
  applyD1Migrations(bindings.PROJECTION_DB, bindings.PROJECTION_MIGRATIONS),
);
afterEach(() => reset());
it("orders revisions, detects equal revision conflicts and fences 100 in flight after rebuilding 60", async () => {
  const old = store(),
    writer = store();
  expect(await old.write({ generation: 1, snapshot })).toBe("applied");
  expect(await old.write({ generation: 1, snapshot })).toBe("duplicate");
  expect(
    await old.write({
      generation: 1,
      snapshot: { ...snapshot, snapshotRevision: 99 },
    }),
  ).toBe("stale");
  expect(
    await old.write({
      generation: 1,
      snapshot: { ...snapshot, title: "different" },
    }),
  ).toBe("conflict");
  const captured = { generation: 1, snapshot };
  expect(
    await writer.beginRecovery({
      installationId: 1,
      repositoryId: 2,
      expectedGeneration: 1,
    }),
  ).toBe(2);
  expect((await writer.list(input)).items).toEqual([]);
  await expect(
    writer.activateRecovery({
      installationId: 1,
      repositoryId: 2,
      expectedGeneration: 2,
    }),
  ).rejects.toThrow("recovery_incomplete");
  expect(
    await writer.write({
      generation: 2,
      snapshot: { ...snapshot, snapshotRevision: 60 },
    }),
  ).toBe("applied");
  await writer.activateRecovery({
    installationId: 1,
    repositoryId: 2,
    expectedGeneration: 2,
  });
  expect(await old.write(captured)).toBe("fenced");
  expect((await writer.list(input)).items[0]?.snapshotRevision).toBe(60);
  await expect(
    writer.beginRecovery({
      installationId: 1,
      repositoryId: 2,
      expectedGeneration: 1,
    }),
  ).rejects.toThrow("recovery_conflict");
});
it("validates persisted/RPC replies and rejects invalid coordinates before SQL", async () => {
  for (const invalid of [
    { ...snapshot, repositoryId: 0 },
    { ...snapshot, token: "private" },
    { ...snapshot, activityAt: "invalid" },
  ])
    await expect(
      store().write({ generation: 1, snapshot: invalid }),
    ).rejects.toThrow();
  await store().write({ generation: 1, snapshot });
  await bindings.PROJECTION_DB.prepare(
    "UPDATE review_projection SET payload='{}'",
  ).run();
  await expect(store().list(input)).rejects.toThrow();
  const broken = new Proxy(bindings.PROJECTION_DB, {
    get(target, property) {
      if (property === "batch")
        return () => Promise.resolve([{ success: false, results: [] }]);
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(
    createProjectionPersistence(broken).write({ generation: 1, snapshot }),
  ).rejects.toThrow("Invalid projection reply");
  await expect(createProjectionPersistence(broken).list(input)).rejects.toThrow(
    "Invalid projection list result",
  );
});
it("supports literal contains, normalization, number-title union and signed scoped keyset cursors", async () => {
  const titles = [
    "CORREÇÃO Ágil",
    "literal %_",
    "number 3",
    "Straße",
    "😀 alpha",
    "ordinary",
  ];
  for (const [index, title] of titles.entries())
    await store().write({
      generation: 1,
      snapshot: { ...snapshot, pullRequestNumber: index + 1, title },
    });
  expect(
    (await store().list({ ...input, search: "correcao agil" })).items.map(
      (x) => x.pullRequestNumber,
    ),
  ).toEqual([1]);
  expect(
    (await store().list({ ...input, search: "%_" })).items.map(
      (x) => x.pullRequestNumber,
    ),
  ).toEqual([2]);
  expect(
    (await store().list({ ...input, search: "3" })).items.map(
      (x) => x.pullRequestNumber,
    ),
  ).toEqual([3]);
  expect((await store().list({ ...input, search: "STRASSE" })).total).toBe(0);
  expect((await store().list({ ...input, search: "😀" })).total).toBe(1);
  const first = await store().list({ ...input, limit: 2 });
  expect(first.items.map((x) => x.pullRequestNumber)).toEqual([6, 5]);
  const second = await store().list({
    ...input,
    limit: 2,
    cursor: first.nextCursor,
  });
  expect(second.items.map((x) => x.pullRequestNumber)).toEqual([4, 3]);
  expect(first.total).toBe(6);
  for (const changed of [
    { repositoryId: 3 },
    { installationId: 2 },
    { workspaceId: "other" },
    { search: "a" },
    { limit: 3 },
    { status: "running" as const },
  ])
    await expect(
      store().list({
        ...input,
        limit: 2,
        ...changed,
        cursor: first.nextCursor,
      }),
    ).rejects.toThrow("invalid_review_cursor");
  for (const cursor of ["broken", first.nextCursor + "x", "x".repeat(1025)])
    await expect(
      store().list({ ...input, limit: 2, cursor }),
    ).rejects.toThrow();
  await expect(store().list({ ...input, limit: 51 })).rejects.toThrow();
  await expect(
    createProjectionPersistence(bindings.PROJECTION_DB).list({
      ...input,
      limit: 2,
    }),
  ).rejects.toThrow("cursor_key_missing");
});
it("queries two repositories of 10,000 PRs before LIMIT; records native D1 work and query plans", async () => {
  await bindings.PROJECTION_DB.prepare(
    "INSERT INTO review_projection_scope VALUES (1,2,1,'active'),(1,3,1,'active')",
  ).run();
  for (const repositoryId of [2, 3])
    await bindings.PROJECTION_DB.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<10000)
 INSERT INTO review_projection SELECT 1,?,i,1,1,?,'awaiting_review', CASE WHEN i=1 THEN 'rare late' ELSE 'ordinary '||i END,
 json_set(?, '$.repositoryId',?,'$.pullRequestNumber',i,'$.snapshotRevision',1,'$.title',CASE WHEN i=1 THEN 'Rare late' ELSE 'Ordinary '||i END) FROM n`)
      .bind(
        repositoryId,
        snapshot.activityAt,
        JSON.stringify(snapshot),
        repositoryId,
      )
      .run();
  const measurements: { sql: string; rowsRead: number; duration: number }[] =
    [];
  const database = new Proxy(bindings.PROJECTION_DB, {
    get(target, property) {
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          const results = await target.batch(statements);
          results.forEach((x) =>
            measurements.push({
              sql: "native batch",
              rowsRead: x.meta.rows_read,
              duration: x.meta.duration,
            }),
          );
          return results;
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const reader = createProjectionPersistence(database, "synthetic cursor key");
  const page = await reader.list(input);
  expect(page.total).toBe(10000);
  expect(page.items).toHaveLength(50);
  expect(page.items[0]?.pullRequestNumber).toBe(10000);
  expect(
    (await reader.list({ ...input, search: "rare late" })).items.map(
      (x) => x.pullRequestNumber,
    ),
  ).toEqual([1]);
  expect((await reader.list({ ...input, search: "nonexistent" })).total).toBe(
    0,
  );
  expect((await reader.list({ ...input, search: "o" })).total).toBe(9999);
  expect(
    (await reader.list({ ...input, search: "rare late", status: "completed" }))
      .total,
  ).toBe(0);
  expect(
    (
      await reader.list({
        ...input,
        repositoryId: 3,
        search: "rare late",
        status: "awaiting_review",
      })
    ).items.map((x) => x.pullRequestNumber),
  ).toEqual([1]);
  expect(
    (
      await reader.list({
        ...input,
        repositoryId: 3,
        search: "nonexistent",
        status: "awaiting_review",
      })
    ).total,
  ).toBe(0);
  const plan = await bindings.PROJECTION_DB.prepare(
    "EXPLAIN QUERY PLAN SELECT payload FROM review_projection WHERE installation_id=? AND repository_id=? AND generation=? ORDER BY activity_at DESC,pull_request_number DESC LIMIT 51",
  )
    .bind(1, 2, 1)
    .all();
  expect(JSON.stringify(plan.results)).toContain("review_projection_activity");
  expect(
    measurements.every(
      (x) => Number.isFinite(x.rowsRead) && Number.isFinite(x.duration),
    ),
  ).toBe(true);
  expect(Math.max(...measurements.map((x) => x.rowsRead))).toBeLessThan(40000);
  console.log(
    "M5 local D1 workload",
    JSON.stringify({
      repositories: 2,
      rowsPerRepository: 10000,
      measurements,
      plan: plan.results,
    }),
  );
});
