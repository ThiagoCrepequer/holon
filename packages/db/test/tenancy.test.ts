import {
  applyD1Migrations,
  env,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { afterEach, expect, it } from "vitest";

import { createTenancyPersistence } from "../src/tenancy.server.js";

interface Bindings {
  IDENTITY_DB: D1Database;
  IDENTITY_MIGRATIONS: D1Migration[];
}

const bindings = env as Bindings;

async function setupDatabase() {
  await applyD1Migrations(bindings.IDENTITY_DB, bindings.IDENTITY_MIGRATIONS);
}

afterEach(async () => {
  await reset();
});

// Helper to seed users
async function seedUser(
  database: D1Database,
  user: { id: string; name: string; email: string; emailVerified: boolean },
) {
  const now = Date.now();
  await database
    .prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(user.id, user.name, user.email, user.emailVerified ? 1 : 0, now, now)
    .run();
}

// Helper to seed linked account
async function seedAccount(
  database: D1Database,
  account: {
    id: string;
    userId: string;
    accountId: string;
    providerId: string;
  },
) {
  const now = Date.now();
  await database
    .prepare(
      `INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      account.id,
      account.accountId,
      account.providerId,
      account.userId,
      now,
      now,
    )
    .run();
}

// Helper to seed active session
async function seedSession(
  database: D1Database,
  session: { id: string; userId: string; token: string; expiresAt: number },
) {
  const now = Date.now();
  await database
    .prepare(
      `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      session.id,
      session.expiresAt,
      session.token,
      now,
      now,
      session.userId,
    )
    .run();
}

it("migration applies cleanly from empty D1 and preserves pre-existing authority and code redemption data", async () => {
  // Apply migrations 0001 and 0002 first
  await applyD1Migrations(
    bindings.IDENTITY_DB,
    bindings.IDENTITY_MIGRATIONS.slice(0, 2),
  );

  // Seed pre-existing code redemption row
  await bindings.IDENTITY_DB.prepare(
    "INSERT INTO github_code_redemption (fingerprint, expires_at) VALUES (?, ?)",
  )
    .bind("a".repeat(64), 9999999999)
    .run();

  // Apply migration 0003
  await applyD1Migrations(bindings.IDENTITY_DB, bindings.IDENTITY_MIGRATIONS);

  // Check that authority and redemption rows are preserved
  const authority = await bindings.IDENTITY_DB.prepare(
    "SELECT * FROM storage_authority",
  ).all();
  expect(authority.results).toHaveLength(1);

  const redemption = await bindings.IDENTITY_DB.prepare(
    "SELECT * FROM github_code_redemption WHERE fingerprint = ?",
  )
    .bind("a".repeat(64))
    .all();
  expect(redemption.results).toHaveLength(1);

  // Verify new tables exist
  const tables = await bindings.IDENTITY_DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  ).all();
  const tableNames = tables.results.map((r) => r.name);
  expect(tableNames).toContain("workspace");
  expect(tableNames).toContain("membership");
  expect(tableNames).toContain("tenancy_operation");
  expect(tableNames).toContain("user");
  expect(tableNames).toContain("account");
  expect(tableNames).toContain("session");
});

it("isolated user without linked account or without active session cannot provision personal workspace", async () => {
  await setupDatabase();
  const tenancy = createTenancyPersistence(bindings.IDENTITY_DB);

  // User 1: Isolated without linked account
  await seedUser(bindings.IDENTITY_DB, {
    id: "user-isolated-1",
    name: "Isolated User",
    email: "isolated@example.invalid",
    emailVerified: true,
  });

  await expect(
    tenancy.provisionPersonalWorkspace("user-isolated-1"),
  ).rejects.toThrow("user_not_admitted");

  // User 2: Has account but session creation failed (incomplete login)
  await seedUser(bindings.IDENTITY_DB, {
    id: "user-no-session-2",
    name: "No Session User",
    email: "no-session@example.invalid",
    emailVerified: true,
  });
  await seedAccount(bindings.IDENTITY_DB, {
    id: "acc-no-session-2",
    userId: "user-no-session-2",
    accountId: "gh-no-session",
    providerId: "github",
  });

  await expect(
    tenancy.provisionPersonalWorkspace("user-no-session-2"),
  ).rejects.toThrow("user_not_admitted");

  // Independent oracle: zero rows in workspace and membership
  const workspaces = await bindings.IDENTITY_DB.prepare(
    "SELECT * FROM workspace",
  ).all();
  expect(workspaces.results).toHaveLength(0);

  const memberships = await bindings.IDENTITY_DB.prepare(
    "SELECT * FROM membership",
  ).all();
  expect(memberships.results).toHaveLength(0);
});

it("admitted user gets personal workspace and owner membership idempotently under concurrency", async () => {
  await setupDatabase();
  const tenancy = createTenancyPersistence(bindings.IDENTITY_DB);

  await seedUser(bindings.IDENTITY_DB, {
    id: "user-admitted-1",
    name: "Admitted User",
    email: "admitted@example.invalid",
    emailVerified: true,
  });
  await seedAccount(bindings.IDENTITY_DB, {
    id: "acc-1",
    userId: "user-admitted-1",
    accountId: "gh-1",
    providerId: "github",
  });
  await seedSession(bindings.IDENTITY_DB, {
    id: "sess-1",
    userId: "user-admitted-1",
    token: "token-1",
    expiresAt: Date.now() + 86400000,
  });

  // Concurrent provisioning calls
  const [res1, res2, res3] = await Promise.all([
    tenancy.provisionPersonalWorkspace("user-admitted-1"),
    tenancy.provisionPersonalWorkspace("user-admitted-1"),
    tenancy.provisionPersonalWorkspace("user-admitted-1"),
  ]);

  expect(res1.workspace.id).toBe(res2.workspace.id);
  expect(res2.workspace.id).toBe(res3.workspace.id);
  expect(res1.workspace.type).toBe("personal");
  expect(res1.membership.role).toBe("owner");

  // Exact database state check: exactly 1 workspace, exactly 1 membership
  const workspaces = await bindings.IDENTITY_DB.prepare(
    "SELECT * FROM workspace WHERE personal_user_id = ?",
  )
    .bind("user-admitted-1")
    .all();
  expect(workspaces.results).toHaveLength(1);

  const memberships = await bindings.IDENTITY_DB.prepare(
    "SELECT * FROM membership WHERE user_id = ?",
  )
    .bind("user-admitted-1")
    .all();
  expect(memberships.results).toHaveLength(1);
  expect(memberships.results[0]?.role).toBe("owner");
});

it("personal workspace rejects non-owner access and schema trigger blocks adding other members", async () => {
  await setupDatabase();
  const tenancy = createTenancyPersistence(bindings.IDENTITY_DB);

  await seedUser(bindings.IDENTITY_DB, {
    id: "user-a",
    name: "User A",
    email: "a@example.invalid",
    emailVerified: true,
  });
  await seedAccount(bindings.IDENTITY_DB, {
    id: "acc-a",
    userId: "user-a",
    accountId: "gh-a",
    providerId: "github",
  });
  await seedSession(bindings.IDENTITY_DB, {
    id: "sess-a",
    userId: "user-a",
    token: "token-a",
    expiresAt: Date.now() + 86400000,
  });

  await seedUser(bindings.IDENTITY_DB, {
    id: "user-b",
    name: "User B",
    email: "b@example.invalid",
    emailVerified: true,
  });
  await seedAccount(bindings.IDENTITY_DB, {
    id: "acc-b",
    userId: "user-b",
    accountId: "gh-b",
    providerId: "github",
  });
  await seedSession(bindings.IDENTITY_DB, {
    id: "sess-b",
    userId: "user-b",
    token: "token-b",
    expiresAt: Date.now() + 86400000,
  });

  const { workspace } = await tenancy.provisionPersonalWorkspace("user-a");

  // User B cannot read or access personal workspace of User A
  const access = await tenancy.readWorkspace("user-b", workspace.id);
  expect(access).toBeNull();

  // Direct SQL test of schema trigger: attempting to insert user-b into workspace-a fails
  // Direct SQL test of schema triggers:
  const now = Date.now();
  // 1. Attempting to insert another user with role 'member' fails
  await expect(
    bindings.IDENTITY_DB.prepare(
      "INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'member', ?, ?)",
    )
      .bind(workspace.id, "user-b", now, now)
      .run(),
  ).rejects.toThrow("personal_workspace_owner_only");

  // 2. Attempting to insert another user with role 'owner' fails
  await expect(
    bindings.IDENTITY_DB.prepare(
      "INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'owner', ?, ?)",
    )
      .bind(workspace.id, "user-b", now, now)
      .run(),
  ).rejects.toThrow("personal_workspace_exclusive");

  // Verify only user-a remains as member
  const members = await bindings.IDENTITY_DB.prepare(
    "SELECT * FROM membership WHERE workspace_id = ?",
  )
    .bind(workspace.id)
    .all();
  expect(members.results).toHaveLength(1);
  expect(members.results[0]?.user_id).toBe("user-a");
});

it("creates team workspace with owner membership atomically; zero-rows guard prevents child insertion", async () => {
  await setupDatabase();
  const tenancy = createTenancyPersistence(bindings.IDENTITY_DB);

  await seedUser(bindings.IDENTITY_DB, {
    id: "user-owner",
    name: "Team Owner",
    email: "owner@example.invalid",
    emailVerified: true,
  });
  await seedAccount(bindings.IDENTITY_DB, {
    id: "acc-owner",
    userId: "user-owner",
    accountId: "gh-owner",
    providerId: "github",
  });
  await seedSession(bindings.IDENTITY_DB, {
    id: "sess-owner",
    userId: "user-owner",
    token: "token-owner",
    expiresAt: Date.now() + 86400000,
  });

  // Valid creation
  const created = await tenancy.createTeamWorkspace("user-owner", {
    name: "Synthetic Team Alpha",
    operationId: "op-create-team-1",
  });

  expect(created.workspace.type).toBe("team");
  expect(created.workspace.name).toBe("Synthetic Team Alpha");
  expect(created.membership.role).toBe("owner");
  expect(created.membership.userId).toBe("user-owner");

  // Unadmitted actor fails and zero-rows guard creates no children
  await seedUser(bindings.IDENTITY_DB, {
    id: "user-unadmitted",
    name: "Unadmitted",
    email: "unadmitted@example.invalid",
    emailVerified: true,
  });

  await expect(
    tenancy.createTeamWorkspace("user-unadmitted", {
      name: "Synthetic Ghost Corp",
      operationId: "op-unadmitted-1",
    }),
  ).rejects.toThrow("user_not_admitted");

  // Verify Ghost Corp was NOT inserted into workspace or membership or tenancy_operation
  const ghostWs = await bindings.IDENTITY_DB.prepare(
    "SELECT * FROM workspace WHERE name = 'Synthetic Ghost Corp'",
  ).all();
  expect(ghostWs.results).toHaveLength(0);

  const ghostMembers = await bindings.IDENTITY_DB.prepare(
    "SELECT * FROM membership WHERE user_id = 'user-unadmitted'",
  ).all();
  expect(ghostMembers.results).toHaveLength(0);

  const ghostOp = await bindings.IDENTITY_DB.prepare(
    "SELECT * FROM tenancy_operation WHERE operation_id = 'op-unadmitted-1'",
  ).all();
  expect(ghostOp.results).toHaveLength(0);
});

it("SQL failure on membership insert triggers full rollback of workspace and tenancy_operation", async () => {
  await setupDatabase();
  const tenancy = createTenancyPersistence(bindings.IDENTITY_DB);

  await seedUser(bindings.IDENTITY_DB, {
    id: "user-fail-test",
    name: "Fail Test User",
    email: "fail-test@example.invalid",
    emailVerified: true,
  });
  await seedAccount(bindings.IDENTITY_DB, {
    id: "acc-fail-test",
    userId: "user-fail-test",
    accountId: "gh-fail-test",
    providerId: "github",
  });
  await seedSession(bindings.IDENTITY_DB, {
    id: "sess-fail-test",
    userId: "user-fail-test",
    token: "token-fail-test",
    expiresAt: Date.now() + 86400000,
  });

  // Create trigger to simulate SQL failure on membership insert
  await bindings.IDENTITY_DB.exec(
    "CREATE TRIGGER synthetic_fail_membership BEFORE INSERT ON membership BEGIN SELECT RAISE(ABORT, 'synthetic_membership_error'); END;",
  );

  await expect(
    tenancy.createTeamWorkspace("user-fail-test", {
      name: "Doomed Team",
      operationId: "op-doomed-1",
    }),
  ).rejects.toThrow();

  // Clean up trigger
  await bindings.IDENTITY_DB.exec("DROP TRIGGER synthetic_fail_membership");

  // Oracle: Rollback desfez workspace AND tenancy_operation
  const doomedWs = await bindings.IDENTITY_DB.prepare(
    "SELECT * FROM workspace WHERE name = 'Doomed Team'",
  ).all();
  expect(doomedWs.results).toHaveLength(0);

  const doomedOp = await bindings.IDENTITY_DB.prepare(
    "SELECT * FROM tenancy_operation WHERE operation_id = 'op-doomed-1'",
  ).all();
  expect(doomedOp.results).toHaveLength(0);

  const doomedMembers = await bindings.IDENTITY_DB.prepare(
    "SELECT * FROM membership WHERE user_id = 'user-fail-test'",
  ).all();
  expect(doomedMembers.results).toHaveLength(0);
});

it("team creation replay is idempotent; concurrent and conflicting key collisions are rejected", async () => {
  await setupDatabase();
  const tenancy = createTenancyPersistence(bindings.IDENTITY_DB);

  await seedUser(bindings.IDENTITY_DB, {
    id: "user-1",
    name: "User 1",
    email: "u1@example.invalid",
    emailVerified: true,
  });
  await seedAccount(bindings.IDENTITY_DB, {
    id: "acc-1",
    userId: "user-1",
    accountId: "gh-1",
    providerId: "github",
  });
  await seedSession(bindings.IDENTITY_DB, {
    id: "sess-1",
    userId: "user-1",
    token: "token-1",
    expiresAt: Date.now() + 86400000,
  });

  await seedUser(bindings.IDENTITY_DB, {
    id: "user-2",
    name: "User 2",
    email: "u2@example.invalid",
    emailVerified: true,
  });
  await seedAccount(bindings.IDENTITY_DB, {
    id: "acc-2",
    userId: "user-2",
    accountId: "gh-2",
    providerId: "github",
  });
  await seedSession(bindings.IDENTITY_DB, {
    id: "sess-2",
    userId: "user-2",
    token: "token-2",
    expiresAt: Date.now() + 86400000,
  });

  // First call succeeds
  const initial = await tenancy.createTeamWorkspace("user-1", {
    name: "Engineering",
    operationId: "op-shared-100",
  });

  // Replay by same user with same payload returns identical workspace idempotently
  const replay = await tenancy.createTeamWorkspace("user-1", {
    name: "Engineering",
    operationId: "op-shared-100",
  });
  expect(replay.workspace.id).toBe(initial.workspace.id);

  // Collision with different actor using same operationId is rejected
  await expect(
    tenancy.createTeamWorkspace("user-2", {
      name: "Engineering",
      operationId: "op-shared-100",
    }),
  ).rejects.toThrow("operation_conflict");

  // Collision by same actor with different payload using same operationId is rejected
  await expect(
    tenancy.createTeamWorkspace("user-1", {
      name: "Different Name",
      operationId: "op-shared-100",
    }),
  ).rejects.toThrow("operation_conflict");

  // Concurrent creation with exact same key by user-1 converges without error
  const [c1, c2] = await Promise.all([
    tenancy.createTeamWorkspace("user-1", {
      name: "Design Team",
      operationId: "op-concurrent-key-1",
    }),
    tenancy.createTeamWorkspace("user-1", {
      name: "Design Team",
      operationId: "op-concurrent-key-1",
    }),
  ]);
  expect(c1.workspace.id).toBe(c2.workspace.id);

  // Independent final read with row counts
  const totalOps = await bindings.IDENTITY_DB.prepare(
    "SELECT COUNT(*) as count FROM tenancy_operation",
  ).all();
  expect(totalOps.results[0]?.count).toBe(2);

  const totalTeams = await bindings.IDENTITY_DB.prepare(
    "SELECT COUNT(*) as count FROM workspace WHERE type = 'team'",
  ).all();
  expect(totalTeams.results[0]?.count).toBe(2);
});

it("maintains N:M memberships with local permissions per workspace and isolates third-party roles", async () => {
  await setupDatabase();
  const tenancy = createTenancyPersistence(bindings.IDENTITY_DB);

  // User Alice (owner of Team Alpha, member of Team Beta)
  await seedUser(bindings.IDENTITY_DB, {
    id: "user-alice",
    name: "Alice",
    email: "alice@example.invalid",
    emailVerified: true,
  });
  await seedAccount(bindings.IDENTITY_DB, {
    id: "acc-alice",
    userId: "user-alice",
    accountId: "gh-alice",
    providerId: "github",
  });
  await seedSession(bindings.IDENTITY_DB, {
    id: "sess-alice",
    userId: "user-alice",
    token: "token-alice",
    expiresAt: Date.now() + 86400000,
  });

  // User Bob (owner of Team Beta, member of Team Gamma)
  await seedUser(bindings.IDENTITY_DB, {
    id: "user-bob",
    name: "Bob",
    email: "bob@example.invalid",
    emailVerified: true,
  });
  await seedAccount(bindings.IDENTITY_DB, {
    id: "acc-bob",
    userId: "user-bob",
    accountId: "gh-bob",
    providerId: "github",
  });
  await seedSession(bindings.IDENTITY_DB, {
    id: "sess-bob",
    userId: "user-bob",
    token: "token-bob",
    expiresAt: Date.now() + 86400000,
  });

  // User Charlie (owner of Team Gamma)
  await seedUser(bindings.IDENTITY_DB, {
    id: "user-charlie",
    name: "Charlie",
    email: "charlie@example.invalid",
    emailVerified: true,
  });
  await seedAccount(bindings.IDENTITY_DB, {
    id: "acc-charlie",
    userId: "user-charlie",
    accountId: "gh-charlie",
    providerId: "github",
  });
  await seedSession(bindings.IDENTITY_DB, {
    id: "sess-charlie",
    userId: "user-charlie",
    token: "token-charlie",
    expiresAt: Date.now() + 86400000,
  });

  const teamAlpha = await tenancy.createTeamWorkspace("user-alice", {
    name: "Team Alpha",
    operationId: "op-alpha",
  });
  const teamBeta = await tenancy.createTeamWorkspace("user-bob", {
    name: "Team Beta",
    operationId: "op-beta",
  });
  const teamGamma = await tenancy.createTeamWorkspace("user-charlie", {
    name: "Team Gamma",
    operationId: "op-gamma",
  });

  // Add Alice to Team Beta as member via direct SQL fixture
  const now = Date.now();
  await bindings.IDENTITY_DB.prepare(
    "INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'member', ?, ?)",
  )
    .bind(teamBeta.workspace.id, "user-alice", now, now)
    .run();

  // Add Bob to Team Gamma as member via direct SQL fixture
  await bindings.IDENTITY_DB.prepare(
    "INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'member', ?, ?)",
  )
    .bind(teamGamma.workspace.id, "user-bob", now, now)
    .run();

  // Check Alice's workspaces: owner in Alpha, member in Beta, null in Gamma
  const aliceWorkspaces = await tenancy.listUserWorkspaces("user-alice");
  expect(aliceWorkspaces).toHaveLength(2);

  const aliceInAlpha = await tenancy.readWorkspace(
    "user-alice",
    teamAlpha.workspace.id,
  );
  expect(aliceInAlpha?.role).toBe("owner");

  const aliceInBeta = await tenancy.readWorkspace(
    "user-alice",
    teamBeta.workspace.id,
  );
  expect(aliceInBeta?.role).toBe("member");

  const aliceInGamma = await tenancy.readWorkspace(
    "user-alice",
    teamGamma.workspace.id,
  );
  expect(aliceInGamma).toBeNull();

  // Check Bob's workspaces: owner in Beta, member in Gamma, null in Alpha
  const bobInAlpha = await tenancy.readWorkspace(
    "user-bob",
    teamAlpha.workspace.id,
  );
  expect(bobInAlpha).toBeNull();

  const bobInBeta = await tenancy.readWorkspace(
    "user-bob",
    teamBeta.workspace.id,
  );
  expect(bobInBeta?.role).toBe("owner");

  const bobInGamma = await tenancy.readWorkspace(
    "user-bob",
    teamGamma.workspace.id,
  );
  expect(bobInGamma?.role).toBe("member");
});

it("rejects corrupted persisted rows in read methods and ignores check constraints in testing", async () => {
  await setupDatabase();
  const tenancy = createTenancyPersistence(bindings.IDENTITY_DB);

  await seedUser(bindings.IDENTITY_DB, {
    id: "user-corrupt-test",
    name: "Corrupt Test",
    email: "corrupt@example.invalid",
    emailVerified: true,
  });

  // Insert real corrupted workspace row by temporarily bypassing constraints
  await bindings.IDENTITY_DB.exec("PRAGMA ignore_check_constraints = ON;");
  await bindings.IDENTITY_DB.prepare(
    "INSERT INTO workspace (id, type, name, personal_user_id, created_at, updated_at) VALUES ('ws-corrupt', 'corrupted_type', 'Corrupt WS', NULL, 0, 0)",
  ).run();
  await bindings.IDENTITY_DB.prepare(
    "INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES ('ws-corrupt', 'user-corrupt-test', 'corrupted_role', 0, 0)",
  ).run();
  await bindings.IDENTITY_DB.exec("PRAGMA ignore_check_constraints = OFF;");

  // Verify the row exists in database
  const directCheck = await bindings.IDENTITY_DB.prepare(
    "SELECT * FROM workspace WHERE id = 'ws-corrupt'",
  ).all();
  expect(directCheck.results).toHaveLength(1);

  // Read methods reject corrupted persisted rows with storage_corrupted error
  await expect(
    tenancy.readWorkspace("user-corrupt-test", "ws-corrupt"),
  ).rejects.toThrow("storage_corrupted");

  await expect(
    tenancy.readMembership("user-corrupt-test", "ws-corrupt"),
  ).rejects.toThrow("storage_corrupted");

  await expect(tenancy.listUserWorkspaces("user-corrupt-test")).rejects.toThrow(
    "storage_corrupted",
  );
});

it("schema trigger blocks UPDATE on personal workspace membership", async () => {
  await setupDatabase();
  const tenancy = createTenancyPersistence(bindings.IDENTITY_DB);

  await seedUser(bindings.IDENTITY_DB, {
    id: "user-up-1",
    name: "Update User 1",
    email: "up1@example.invalid",
    emailVerified: true,
  });
  await seedAccount(bindings.IDENTITY_DB, {
    id: "acc-up-1",
    userId: "user-up-1",
    accountId: "gh-up-1",
    providerId: "github",
  });
  await seedSession(bindings.IDENTITY_DB, {
    id: "sess-up-1",
    userId: "user-up-1",
    token: "token-up-1",
    expiresAt: Date.now() + 86400000,
  });

  await seedUser(bindings.IDENTITY_DB, {
    id: "user-up-2",
    name: "Update User 2",
    email: "up2@example.invalid",
    emailVerified: true,
  });

  const { workspace } = await tenancy.provisionPersonalWorkspace("user-up-1");

  // Attempting to UPDATE the membership to point to user-up-2 fails due to the UPDATE trigger
  await expect(
    bindings.IDENTITY_DB.prepare(
      "UPDATE membership SET user_id = ? WHERE workspace_id = ?",
    )
      .bind("user-up-2", workspace.id)
      .run(),
  ).rejects.toThrow("personal_workspace_exclusive");
});

it("validates team workspace input and operation ID", async () => {
  await setupDatabase();
  const tenancy = createTenancyPersistence(bindings.IDENTITY_DB);

  await seedUser(bindings.IDENTITY_DB, {
    id: "user-val",
    name: "Validation User",
    email: "val@example.invalid",
    emailVerified: true,
  });
  await seedAccount(bindings.IDENTITY_DB, {
    id: "acc-val",
    userId: "user-val",
    accountId: "gh-val",
    providerId: "github",
  });
  await seedSession(bindings.IDENTITY_DB, {
    id: "sess-val",
    userId: "user-val",
    token: "token-val",
    expiresAt: Date.now() + 86400000,
  });

  // Empty or whitespace name
  await expect(
    tenancy.createTeamWorkspace("user-val", {
      name: "   ",
      operationId: "op-valid",
    }),
  ).rejects.toThrow();

  // Name exceeding 128 chars
  await expect(
    tenancy.createTeamWorkspace("user-val", {
      name: "x".repeat(129),
      operationId: "op-valid",
    }),
  ).rejects.toThrow();

  // Invalid operation ID with special characters
  await expect(
    tenancy.createTeamWorkspace("user-val", {
      name: "Valid Team",
      operationId: "invalid op!",
    }),
  ).rejects.toThrow();
});

it("readMembership returns active membership and null when not found", async () => {
  await setupDatabase();
  const tenancy = createTenancyPersistence(bindings.IDENTITY_DB);

  await seedUser(bindings.IDENTITY_DB, {
    id: "user-mem",
    name: "Member User",
    email: "mem@example.invalid",
    emailVerified: true,
  });
  await seedAccount(bindings.IDENTITY_DB, {
    id: "acc-mem",
    userId: "user-mem",
    accountId: "gh-mem",
    providerId: "github",
  });
  await seedSession(bindings.IDENTITY_DB, {
    id: "sess-mem",
    userId: "user-mem",
    token: "token-mem",
    expiresAt: Date.now() + 86400000,
  });

  const { workspace } = await tenancy.createTeamWorkspace("user-mem", {
    name: "Member Test Team",
    operationId: "op-mem-1",
  });

  const member = await tenancy.readMembership("user-mem", workspace.id);
  expect(member).toEqual({ workspaceId: workspace.id, role: "owner" });

  const nonMember = await tenancy.readMembership("other-user", workspace.id);
  expect(nonMember).toBeNull();
});

it("sequential provisioning returns existing personal workspace via existing check", async () => {
  await setupDatabase();
  const tenancy = createTenancyPersistence(bindings.IDENTITY_DB);

  await seedUser(bindings.IDENTITY_DB, {
    id: "user-seq",
    name: "Seq User",
    email: "seq@example.invalid",
    emailVerified: true,
  });
  await seedAccount(bindings.IDENTITY_DB, {
    id: "acc-seq",
    userId: "user-seq",
    accountId: "gh-seq",
    providerId: "github",
  });
  await seedSession(bindings.IDENTITY_DB, {
    id: "sess-seq",
    userId: "user-seq",
    token: "token-seq",
    expiresAt: Date.now() + 86400000,
  });

  const first = await tenancy.provisionPersonalWorkspace("user-seq");
  const second = await tenancy.provisionPersonalWorkspace("user-seq");
  expect(second.workspace.id).toBe(first.workspace.id);
});

it("simultaneous concurrent collision with different actors triggers conflict in race", async () => {
  await setupDatabase();
  const tenancy = createTenancyPersistence(bindings.IDENTITY_DB);

  await seedUser(bindings.IDENTITY_DB, {
    id: "user-race-1",
    name: "Race User 1",
    email: "race1@example.invalid",
    emailVerified: true,
  });
  await seedAccount(bindings.IDENTITY_DB, {
    id: "acc-race-1",
    userId: "user-race-1",
    accountId: "gh-race-1",
    providerId: "github",
  });
  await seedSession(bindings.IDENTITY_DB, {
    id: "sess-race-1",
    userId: "user-race-1",
    token: "token-race-1",
    expiresAt: Date.now() + 86400000,
  });

  await seedUser(bindings.IDENTITY_DB, {
    id: "user-race-2",
    name: "Race User 2",
    email: "race2@example.invalid",
    emailVerified: true,
  });
  await seedAccount(bindings.IDENTITY_DB, {
    id: "acc-race-2",
    userId: "user-race-2",
    accountId: "gh-race-2",
    providerId: "github",
  });
  await seedSession(bindings.IDENTITY_DB, {
    id: "sess-race-2",
    userId: "user-race-2",
    token: "token-race-2",
    expiresAt: Date.now() + 86400000,
  });

  const results = await Promise.allSettled([
    tenancy.createTeamWorkspace("user-race-1", {
      name: "Race Team",
      operationId: "op-race-conflict-1",
    }),
    tenancy.createTeamWorkspace("user-race-2", {
      name: "Race Team",
      operationId: "op-race-conflict-1",
    }),
  ]);

  const rejected = results.filter((r) => r.status === "rejected");
  expect(rejected.length).toBeGreaterThanOrEqual(1);
});
