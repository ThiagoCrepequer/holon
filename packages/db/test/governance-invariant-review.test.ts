import {
  applyD1Migrations,
  env,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { afterEach, expect, it } from "vitest";
const bindings = env as {
  IDENTITY_DB: D1Database;
  IDENTITY_MIGRATIONS: D1Migration[];
};
afterEach(async () => {
  await reset();
});
async function team() {
  const database = bindings.IDENTITY_DB;
  await applyD1Migrations(database, bindings.IDENTITY_MIGRATIONS);
  for (const id of ["owner_a", "owner_b"])
    await database
      .prepare(
        "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, 1, 1)",
      )
      .bind(id, id, `${id}@example.invalid`)
      .run();
  await database
    .prepare(
      "INSERT INTO workspace (id, type, name, personal_user_id, created_at, updated_at) VALUES ('team_race', 'team', 'Race', NULL, 1, 1)",
    )
    .run();
  for (const id of ["owner_a", "owner_b"])
    await database
      .prepare(
        "INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES ('team_race', ?, 'owner', 1, 1)",
      )
      .bind(id)
      .run();
  return database;
}
for (const actions of [
  ["remove", "remove"],
  ["demote", "demote"],
  ["remove", "demote"],
] as const) {
  it(`storage invariant keeps an owner during simultaneous ${actions.join("/")} commands`, async () => {
    const database = await team();
    const results = await Promise.allSettled(
      actions.map((action, index) =>
        database
          .prepare(
            action === "remove"
              ? "DELETE FROM membership WHERE workspace_id = 'team_race' AND user_id = ?"
              : "UPDATE membership SET role = 'member' WHERE workspace_id = 'team_race' AND user_id = ?",
          )
          .bind(index === 0 ? "owner_a" : "owner_b")
          .run(),
      ),
    );
    const remaining = await database
      .prepare(
        "SELECT user_id FROM membership WHERE workspace_id = 'team_race' AND role = 'owner'",
      )
      .all<{ user_id: string }>();
    expect(remaining.results).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  });
}
