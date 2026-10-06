import {
  env,
  applyD1Migrations,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { afterEach, expect, it } from "vitest";

import { createIdentityPersistence } from "../src/identity.server.js";
import { createProjectionPersistence } from "../src/projection.server.js";
interface Bindings {
  IDENTITY_DB: D1Database;
  PROJECTION_DB: D1Database;
  IDENTITY_MIGRATIONS: D1Migration[];
  PROJECTION_MIGRATIONS: D1Migration[];
}
const bindings = env as Bindings;
async function initialize() {
  await applyD1Migrations(bindings.IDENTITY_DB, bindings.IDENTITY_MIGRATIONS);
  await applyD1Migrations(
    bindings.PROJECTION_DB,
    bindings.PROJECTION_MIGRATIONS,
  );
}
afterEach(async () => {
  await reset();
});
it("real D1 migrations and factories reject wrong authority or corrupt persisted state", async () => {
  await initialize();
  const identity = createIdentityPersistence(bindings.IDENTITY_DB);
  const projection = createProjectionPersistence(bindings.PROJECTION_DB);
  await identity.assertReady();
  await projection.assertReady();
  await expect(
    createIdentityPersistence(bindings.PROJECTION_DB).assertReady(),
  ).rejects.toThrow("storage_authority_mismatch");
  await expect(
    createProjectionPersistence(bindings.IDENTITY_DB).assertReady(),
  ).rejects.toThrow("storage_authority_mismatch");
  await bindings.IDENTITY_DB.exec("DELETE FROM storage_authority");
  await expect(identity.assertReady()).rejects.toThrow(
    "storage_authority_mismatch",
  );
});
it("migrations apply from empty and preserve prior authority rows on upgrade", async () => {
  await applyD1Migrations(
    bindings.IDENTITY_DB,
    bindings.IDENTITY_MIGRATIONS.slice(0, 1),
  );
  const before = await bindings.IDENTITY_DB.prepare(
    "SELECT * FROM storage_authority",
  ).all();
  await applyD1Migrations(bindings.IDENTITY_DB, bindings.IDENTITY_MIGRATIONS);
  expect(
    (
      await bindings.IDENTITY_DB.prepare(
        "SELECT * FROM storage_authority",
      ).all()
    ).results,
  ).toEqual(before.results);
  await expect(
    bindings.IDENTITY_DB.prepare(
      "INSERT INTO storage_authority VALUES (2, 'identity')",
    ).run(),
  ).rejects.toThrow();
});
it("concurrent OAuth reservations converge, preserve scope and never persist raw codes", async () => {
  await initialize();
  const first = createIdentityPersistence(bindings.IDENTITY_DB),
    second = createIdentityPersistence(bindings.IDENTITY_DB);
  const winners = await Promise.all([
    first.reserveGithubCode("client-a", "synthetic-code"),
    second.reserveGithubCode("client-a", "synthetic-code"),
  ]);
  expect(winners.filter(Boolean)).toHaveLength(1);
  expect(await first.reserveGithubCode("client-a", "synthetic-code")).toBe(
    false,
  );
  expect(await first.reserveGithubCode("client-b", "synthetic-code")).toBe(
    true,
  );
  const rows = (
    await bindings.IDENTITY_DB.prepare(
      "SELECT * FROM github_code_redemption",
    ).all()
  ).results;
  expect(rows).toHaveLength(2);
  expect(JSON.stringify(rows)).not.toContain("synthetic-code");
  expect(JSON.stringify(rows)).not.toContain("client-a");
});
it("bounded maintenance removes expired markers without touching live ones and rolls back on failed reservation", async () => {
  await initialize();
  const store = createIdentityPersistence(bindings.IDENTITY_DB);
  for (let i = 0; i < 101; i++)
    await bindings.IDENTITY_DB.prepare(
      "INSERT INTO github_code_redemption VALUES (?,0)",
    )
      .bind(String(i).padStart(64, "0"))
      .run();
  await store.reserveGithubCode("client", "live-code");
  expect(
    (
      await bindings.IDENTITY_DB.prepare(
        "SELECT * FROM github_code_redemption WHERE expires_at=0",
      ).all()
    ).results,
  ).toHaveLength(1);
  await bindings.IDENTITY_DB.exec(
    "CREATE TRIGGER fail_reservation BEFORE INSERT ON github_code_redemption BEGIN SELECT RAISE(ABORT,'synthetic_failure'); END;",
  );
  await expect(store.reserveGithubCode("client", "new-code")).rejects.toThrow();
  expect(
    (
      await bindings.IDENTITY_DB.prepare(
        "SELECT * FROM github_code_redemption WHERE expires_at=0",
      ).all()
    ).results,
  ).toHaveLength(1);
  await bindings.IDENTITY_DB.exec("DROP TRIGGER fail_reservation");
  await store.pruneExpiredGithubCodes();
  expect(
    (
      await bindings.IDENTITY_DB.prepare(
        "SELECT * FROM github_code_redemption",
      ).all()
    ).results,
  ).toHaveLength(1);
});
it("ambiguous binding replies cannot grant the reservation", async () => {
  await initialize();
  const replies: unknown[] = [
    null,
    [],
    [
      { success: true, results: [] },
      { success: false, results: [] },
    ],
    [
      { success: true, results: [] },
      { success: true, results: [{ fingerprint: "wrong" }] },
    ],
    [
      { success: true, results: [] },
      { success: true, results: [null] },
    ],
    [
      { success: true, results: [] },
      { success: true, results: [{}, {}] },
    ],
  ];
  for (const reply of replies) {
    const database = new Proxy(bindings.IDENTITY_DB, {
      get(target, property) {
        if (property === "batch") return () => Promise.resolve(reply);
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(
      createIdentityPersistence(database).reserveGithubCode(
        "client",
        "synthetic",
      ),
    ).rejects.toThrow("Invalid OAuth reservation result");
  }
  const failed = new Proxy(bindings.IDENTITY_DB, {
    get(target, property) {
      if (property === "prepare")
        return () => ({ run: () => Promise.resolve({ success: false }) });
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(
    createIdentityPersistence(failed).pruneExpiredGithubCodes(),
  ).rejects.toThrow("OAuth reservation cleanup failed");
});
