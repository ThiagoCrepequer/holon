import {
  applyD1Migrations,
  env,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";

import { createTenancyPersistence } from "../src/tenancy.server.js";

const bindings = env as {
  IDENTITY_DB: D1Database;
  IDENTITY_MIGRATIONS: D1Migration[];
};

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

async function admitActor() {
  const database = bindings.IDENTITY_DB;
  await applyD1Migrations(database, bindings.IDENTITY_MIGRATIONS);
  const now = Date.now();
  await database.batch([
    database
      .prepare(
        "INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES ('review_actor','Synthetic actor','review@example.invalid',1,?,?)",
      )
      .bind(now, now),
    database
      .prepare(
        "INSERT INTO account (id,accountId,providerId,userId,createdAt,updatedAt) VALUES ('review_account','synthetic_subject','github','review_actor',?,?)",
      )
      .bind(now, now),
    database
      .prepare(
        "INSERT INTO session (id,token,userId,expiresAt,createdAt,updatedAt) VALUES ('review_session','synthetic_session_token','review_actor',?,?,?)",
      )
      .bind(now + 60_000, now, now),
  ]);
  return database;
}

it("denied admission at the batch creates no personal child for an existing parent", async () => {
  const database = await admitActor();
  await database
    .prepare(
      "INSERT INTO workspace (id,type,name,personal_user_id,created_at,updated_at) VALUES ('existing_personal','personal','Synthetic personal','review_actor',0,0)",
    )
    .run();
  const interleaved = new Proxy(database, {
    get(target, property) {
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          await database
            .prepare("DELETE FROM session WHERE userId='review_actor'")
            .run();
          return database.batch(statements);
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(
    createTenancyPersistence(interleaved).provisionPersonalWorkspace(
      "review_actor",
    ),
  ).rejects.toThrow();
  expect(
    (await database.prepare("SELECT * FROM membership").all()).results,
  ).toHaveLength(0);
  expect(
    (await database.prepare("SELECT * FROM workspace").all()).results,
  ).toHaveLength(1);
});

it("denied team admission cannot create children on an existing generated ID", async () => {
  const database = await admitActor();
  const generatedId = "ws_00000000000040008000000000000001";
  await database.batch([
    database.prepare(
      "INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES ('other_actor','Other synthetic actor','other@example.invalid',1,0,0)",
    ),
    database
      .prepare(
        "INSERT INTO workspace (id,type,name,personal_user_id,created_at,updated_at) VALUES (?,'team','Existing team',NULL,0,0)",
      )
      .bind(generatedId),
    database
      .prepare(
        "INSERT INTO membership (workspace_id,user_id,role,created_at,updated_at) VALUES (?,'other_actor','owner',0,0)",
      )
      .bind(generatedId),
  ]);
  vi.spyOn(crypto, "randomUUID").mockReturnValue(
    "00000000-0000-4000-8000-000000000001",
  );
  const interleaved = new Proxy(database, {
    get(target, property) {
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          await database
            .prepare("DELETE FROM session WHERE userId='review_actor'")
            .run();
          return database.batch(statements);
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(
    createTenancyPersistence(interleaved).createTeamWorkspace("review_actor", {
      name: "New team",
      operationId: "review_denied_team",
    }),
  ).rejects.toThrow();
  expect(
    (
      await database
        .prepare("SELECT user_id,role FROM membership ORDER BY user_id")
        .all()
    ).results,
  ).toEqual([{ user_id: "other_actor", role: "owner" }]);
  expect(
    (await database.prepare("SELECT * FROM tenancy_operation").all()).results,
  ).toHaveLength(0);
  expect(
    await database
      .prepare("SELECT name FROM workspace WHERE id=?")
      .bind(generatedId)
      .first(),
  ).toEqual({ name: "Existing team" });
});

it("a personal membership cannot be demoted", async () => {
  const database = await admitActor();
  const result =
    await createTenancyPersistence(database).provisionPersonalWorkspace(
      "review_actor",
    );
  await expect(
    database
      .prepare("UPDATE membership SET role='member' WHERE workspace_id=?")
      .bind(result.workspace.id)
      .run(),
  ).rejects.toThrow();
  expect(
    await database
      .prepare("SELECT type,personal_user_id FROM workspace WHERE id=?")
      .bind(result.workspace.id)
      .first(),
  ).toEqual({ type: "personal", personal_user_id: "review_actor" });
});

it("a personal workspace cannot be silently converted to a team", async () => {
  const database = await admitActor();
  const result =
    await createTenancyPersistence(database).provisionPersonalWorkspace(
      "review_actor",
    );
  await expect(
    database
      .prepare(
        "UPDATE workspace SET type='team',personal_user_id=NULL WHERE id=?",
      )
      .bind(result.workspace.id)
      .run(),
  ).rejects.toThrow();
  expect(
    await database
      .prepare("SELECT type,personal_user_id FROM workspace WHERE id=?")
      .bind(result.workspace.id)
      .first(),
  ).toEqual({ type: "personal", personal_user_id: "review_actor" });
});

it("persisted IDs outside the boundary contract cannot be returned as authorized workspaces", async () => {
  const database = await admitActor();
  await database
    .prepare(
      "INSERT INTO workspace (id,type,name,personal_user_id,created_at,updated_at) VALUES ('invalid/id','team','Synthetic corrupt ID',NULL,0,0)",
    )
    .run();
  await database
    .prepare(
      "INSERT INTO membership (workspace_id,user_id,role,created_at,updated_at) VALUES ('invalid/id','review_actor','owner',0,0)",
    )
    .run();
  expect(
    await database
      .prepare("SELECT id FROM workspace WHERE id='invalid/id'")
      .first(),
  ).toEqual({ id: "invalid/id" });
  const store = createTenancyPersistence(database);
  await expect(
    store.readWorkspace("review_actor", "invalid/id"),
  ).rejects.toThrow();
  await expect(store.listUserWorkspaces("review_actor")).rejects.toThrow();
});

it("creation replay uses the current membership and cannot recreate a removed participant", async () => {
  const database = await admitActor();
  const store = createTenancyPersistence(database);
  const command = { name: "Synthetic team", operationId: "review_creation" };
  const created = await store.createTeamWorkspace("review_actor", command);
  await database
    .prepare("UPDATE membership SET role='member' WHERE workspace_id=?")
    .bind(created.workspace.id)
    .run();
  expect(
    (await store.createTeamWorkspace("review_actor", command)).membership.role,
  ).toBe("member");
  await database
    .prepare("DELETE FROM membership WHERE workspace_id=?")
    .bind(created.workspace.id)
    .run();
  await expect(
    store.createTeamWorkspace("review_actor", command),
  ).rejects.toThrow();
  expect(
    (await database.prepare("SELECT * FROM membership").all()).results,
  ).toHaveLength(0);
  expect(
    (await database.prepare("SELECT * FROM workspace").all()).results,
  ).toHaveLength(1);
  expect(
    (await database.prepare("SELECT * FROM tenancy_operation").all()).results,
  ).toHaveLength(1);
});
