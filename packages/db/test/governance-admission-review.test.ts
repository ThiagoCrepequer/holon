import type { AdmittedUser } from "@holon/contracts/dashboard";
import {
  applyD1Migrations,
  env,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";

import {
  createTenancyPersistence,
  TenancyError,
} from "../src/tenancy.server.js";

const bindings = env as {
  IDENTITY_DB: D1Database;
  IDENTITY_MIGRATIONS: D1Migration[];
};
afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});
async function fixture() {
  const database = bindings.IDENTITY_DB;
  await applyD1Migrations(database, bindings.IDENTITY_MIGRATIONS);
  const now = Date.now();
  for (const id of ["review_owner", "other_owner", "review_member"]) {
    await database
      .prepare(
        "INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,?,?)",
      )
      .bind(id, id, `${id}@example.invalid`, now, now)
      .run();
  }
  await database.batch([
    database
      .prepare(
        "INSERT INTO account (id,accountId,providerId,userId,createdAt,updatedAt) VALUES ('review_account','review_subject','github','review_owner',?,?)",
      )
      .bind(now, now),
    database
      .prepare(
        "INSERT INTO session (id,token,userId,expiresAt,createdAt,updatedAt) VALUES ('review_session','synthetic_token','review_owner',?,?,?)",
      )
      .bind(now + 60_000, now, now),
    database
      .prepare(
        "INSERT INTO workspace (id,type,name,personal_user_id,created_at,updated_at) VALUES ('review_team','team','Team',NULL,?,?)",
      )
      .bind(now, now),
    ...["review_owner", "other_owner", "review_member"].map((id) =>
      database
        .prepare(
          "INSERT INTO membership (workspace_id,user_id,role,created_at,updated_at) VALUES ('review_team',?,?,?,?)",
        )
        .bind(id, id === "review_member" ? "member" : "owner", now, now),
    ),
  ]);
  const actor: AdmittedUser = {
    id: "review_owner",
    name: "Review owner",
    githubAccountId: "review_subject",
    sessionId: "review_session",
    expiresAt: new Date(now + 60_000).toISOString(),
  };
  return { database, actor };
}

function interleaveIntentWrite(
  database: D1Database,
  change: () => Promise<unknown>,
) {
  let changed = false;
  async function beforeWrite() {
    if (!changed) {
      changed = true;
      await change();
    }
  }
  return new Proxy(database, {
    get(target, property) {
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          await beforeWrite();
          return database.batch(statements);
        };
      if (property === "prepare")
        return (sql: string) => {
          const statement = database.prepare(sql);
          if (!/INSERT\s+INTO\s+reauth_intent/iu.test(sql)) return statement;
          function wrap(prepared: D1PreparedStatement): D1PreparedStatement {
            return new Proxy(prepared, {
              get(inner, key) {
                if (key === "bind")
                  return (...args: unknown[]) => wrap(inner.bind(...args));
                if (key === "run" || key === "all" || key === "first")
                  return async (...args: unknown[]) => {
                    await beforeWrite();
                    return Reflect.apply(Reflect.get(inner, key), inner, args);
                  };
                const value = Reflect.get(inner, key);
                return typeof value === "function" ? value.bind(inner) : value;
              },
            });
          }
          return wrap(statement);
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

it("reauth initialization prunes a bounded expired batch while preserving live pending and confirmed proofs", async () => {
  const { database, actor } = await fixture();
  const tenancy = createTenancyPersistence(database);
  const input = {
    workspaceId: "review_team",
    action: "promote" as const,
    targetUserId: "review_member",
  };
  const pending = await tenancy.createReauthIntent(actor, input);
  const confirmed = await tenancy.createReauthIntent(actor, input);
  const now = Date.now();
  await database.batch([
    database
      .prepare(
        "INSERT INTO session (id,token,userId,expiresAt,createdAt,updatedAt) VALUES ('retention_proof','synthetic_retention_proof','review_owner',?,?,?)",
      )
      .bind(now + 60_000, now, now),
    database
      .prepare("UPDATE reauth_intent SET created_at=? WHERE id=?")
      .bind(now - 11 * 60_000, confirmed.reauthIntentId),
  ]);
  expect(
    await tenancy.confirmReauthIntent(
      confirmed.reauthIntentId,
      actor.githubAccountId,
      actor.id,
      "retention_proof",
    ),
  ).toBe(true);
  // Expiration, rather than creation age or consumption, decides retention.
  await database
    .prepare(
      `WITH RECURSIVE expired(n) AS (
         SELECT 1 UNION ALL SELECT n+1 FROM expired WHERE n < 120
       )
       INSERT INTO reauth_intent (
         id,user_id,account_id,original_session_id,workspace_id,action,target_user_id,
         created_at,expires_at,confirmed_at,consumed_at
       )
       SELECT 'retention_expired_' || n,user_id,account_id,original_session_id,
         workspace_id,action,target_user_id,0,0,
         CASE WHEN n % 2 = 0 THEN 0 ELSE NULL END,
         CASE WHEN n % 2 = 0 THEN 0 ELSE NULL END
       FROM expired CROSS JOIN reauth_intent WHERE id=?`,
    )
    .bind(pending.reauthIntentId)
    .run();

  await tenancy.createReauthIntent(actor, input);
  expect(
    await database
      .prepare("SELECT COUNT(*) AS count FROM reauth_intent WHERE expires_at=0")
      .first("count"),
  ).toBe(20);
  await tenancy.createReauthIntent(actor, input);
  expect(
    await database
      .prepare("SELECT COUNT(*) AS count FROM reauth_intent WHERE expires_at=0")
      .first("count"),
  ).toBe(0);
  expect(
    await tenancy.readPendingReauthContext(
      pending.reauthIntentId,
      actor.sessionId,
      actor.id,
    ),
  ).not.toBeNull();
  expect(
    await database
      .prepare("SELECT confirmed_at, consumed_at FROM reauth_intent WHERE id=?")
      .bind(confirmed.reauthIntentId)
      .first(),
  ).toEqual({ confirmed_at: expect.any(Number), consumed_at: null });
  await expect(
    tenancy.promoteMember(
      { ...actor, sessionId: "retention_proof" },
      "review_team",
      {
        targetUserId: "review_member",
        reauthIntentId: confirmed.reauthIntentId,
      },
    ),
  ).resolves.toMatchObject({ role: "owner" });
});

for (const loss of ["session", "owner-role"] as const) {
  it(`reauth initialization cannot persist an intent after ${loss} is lost at the write`, async () => {
    const { database, actor } = await fixture();
    const interleaved = interleaveIntentWrite(database, () =>
      database
        .prepare(
          loss === "session"
            ? "DELETE FROM session WHERE id='review_session'"
            : "UPDATE membership SET role='member' WHERE workspace_id='review_team' AND user_id='review_owner'",
        )
        .run(),
    );
    await expect(
      createTenancyPersistence(interleaved).createReauthIntent(actor, {
        workspaceId: "review_team",
        action: "promote",
        targetUserId: "review_member",
      }),
    ).rejects.toThrow();
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM reauth_intent")
        .first("count"),
    ).toBe(0);
    expect(
      await database
        .prepare(
          "SELECT role FROM membership WHERE workspace_id='review_team' AND user_id='review_member'",
        )
        .first("role"),
    ).toBe("member");
  });
}

it("a pending intent and an existing session cannot promote before a native OAuth completes", async () => {
  const { database, actor } = await fixture();
  const tenancy = createTenancyPersistence(database);
  const receipt = await tenancy.createReauthIntent(actor, {
    workspaceId: "review_team",
    action: "promote",
    targetUserId: "review_member",
  });
  await expect(
    tenancy.promoteMember(actor, "review_team", {
      targetUserId: "review_member",
      reauthIntentId: receipt.reauthIntentId,
    }),
  ).rejects.toMatchObject({ code: "reauth_required" });
  expect(
    await database
      .prepare(
        "SELECT role FROM membership WHERE workspace_id='review_team' AND user_id='review_member'",
      )
      .first("role"),
  ).toBe("member");
  expect(
    await database
      .prepare("SELECT confirmed_at,consumed_at FROM reauth_intent WHERE id=?")
      .bind(receipt.reauthIntentId)
      .first(),
  ).toEqual({ confirmed_at: null, consumed_at: null });
});

for (const loss of [
  "session",
  "owner-role",
  "target-member",
  "proof-expiry",
] as const) {
  it(`governance rechecks ${loss} at the batch and leaves proof and membership unchanged`, async () => {
    const { database, actor } = await fixture();
    const tenancy = createTenancyPersistence(database);
    const receipt = await tenancy.createReauthIntent(actor, {
      workspaceId: "review_team",
      action: "promote",
      targetUserId: "review_member",
    });
    const now = Date.now();
    await database
      .prepare(
        "INSERT INTO session (id,token,userId,expiresAt,createdAt,updatedAt) VALUES ('review_proof','synthetic_proof_token','review_owner',?,?,?)",
      )
      .bind(now + 60_000, now, now)
      .run();
    expect(
      await tenancy.confirmReauthIntent(
        receipt.reauthIntentId,
        actor.githubAccountId,
        actor.id,
        "review_proof",
      ),
    ).toBe(true);
    const proofActor = { ...actor, sessionId: "review_proof" };
    const interleaved = new Proxy(database, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            const changes = {
              session: "DELETE FROM session WHERE id='review_proof'",
              "owner-role":
                "UPDATE membership SET role='member' WHERE workspace_id='review_team' AND user_id='review_owner'",
              "target-member":
                "DELETE FROM membership WHERE workspace_id='review_team' AND user_id='review_member'",
              "proof-expiry":
                "UPDATE reauth_intent SET expires_at=CAST(unixepoch('subsec')*1000 AS INTEGER)",
            };
            await database.prepare(changes[loss]).run();
            return database.batch(statements);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(
      createTenancyPersistence(interleaved).promoteMember(
        proofActor,
        "review_team",
        {
          targetUserId: "review_member",
          reauthIntentId: receipt.reauthIntentId,
        },
      ),
    ).rejects.toBeInstanceOf(TenancyError);
    expect(
      await database
        .prepare(
          "SELECT role FROM membership WHERE workspace_id='review_team' AND user_id='review_member'",
        )
        .first("role"),
    ).toBe(loss === "target-member" ? null : "member");
    expect(
      await database
        .prepare("SELECT consumed_at FROM reauth_intent WHERE id=?")
        .bind(receipt.reauthIntentId)
        .first("consumed_at"),
    ).toBeNull();
    expect(
      await database
        .prepare("SELECT COUNT(*) FROM tenancy_mutation_guard")
        .first("COUNT(*)"),
    ).toBe(0);
  });
}

for (const proof of ["missing", "other-user", "original"] as const) {
  it(`confirmation rejects a ${proof} proof session without marking the pending intent`, async () => {
    const { database, actor } = await fixture();
    const tenancy = createTenancyPersistence(database);
    const receipt = await tenancy.createReauthIntent(actor, {
      workspaceId: "review_team",
      action: "promote",
      targetUserId: "review_member",
    });
    if (proof === "other-user") {
      const now = Date.now();
      await database
        .prepare(
          "INSERT INTO session (id,token,userId,expiresAt,createdAt,updatedAt) VALUES ('wrong_proof','synthetic_wrong_token','review_member',?,?,?)",
        )
        .bind(now + 60_000, now, now)
        .run();
    }
    expect(
      await tenancy.confirmReauthIntent(
        receipt.reauthIntentId,
        actor.githubAccountId,
        actor.id,
        proof === "original" ? actor.sessionId : "wrong_proof",
      ),
    ).toBe(false);
    expect(
      await database
        .prepare(
          "SELECT confirmed_at,proof_session_id FROM reauth_intent WHERE id=?",
        )
        .bind(receipt.reauthIntentId)
        .first(),
    ).toEqual({ confirmed_at: null, proof_session_id: null });
  });
}

for (const reconciliationFails of [false, true]) {
  it(`lost batch confirmation reports an unknown command even when reconciliation fails=${reconciliationFails}`, async () => {
    const { database, actor } = await fixture();
    const tenancy = createTenancyPersistence(database);
    const receipt = await tenancy.createReauthIntent(actor, {
      workspaceId: "review_team",
      action: "promote",
      targetUserId: "review_member",
    });
    const now = Date.now();
    await database
      .prepare(
        "INSERT INTO session (id,token,userId,expiresAt,createdAt,updatedAt) VALUES ('review_proof','synthetic_proof_token','review_owner',?,?,?)",
      )
      .bind(now + 60_000, now, now)
      .run();
    expect(
      await tenancy.confirmReauthIntent(
        receipt.reauthIntentId,
        actor.githubAccountId,
        actor.id,
        "review_proof",
      ),
    ).toBe(true);
    const proofActor = { ...actor, sessionId: "review_proof" };
    let committed = false;
    const lost = new Proxy(database, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            await database.batch(statements);
            committed = true;
            throw new Error("Synthetic lost response after commit");
          };
        if (property === "prepare" && reconciliationFails)
          return (sql: string) => {
            if (
              committed &&
              /SELECT consumed_at FROM reauth_intent/iu.test(sql)
            ) {
              throw new Error("Synthetic receipt storage unavailable");
            }
            return database.prepare(sql);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(
      createTenancyPersistence(lost).promoteMember(proofActor, "review_team", {
        targetUserId: "review_member",
        reauthIntentId: receipt.reauthIntentId,
      }),
    ).rejects.toMatchObject({ code: "command_unknown" });
    expect(
      await database
        .prepare(
          "SELECT role FROM membership WHERE workspace_id='review_team' AND user_id='review_member'",
        )
        .first("role"),
    ).toBe("owner");
    expect(
      await database
        .prepare("SELECT consumed_at FROM reauth_intent WHERE id=?")
        .bind(receipt.reauthIntentId)
        .first("consumed_at"),
    ).not.toBeNull();
    await database
      .prepare(
        "DELETE FROM membership WHERE workspace_id='review_team' AND user_id='review_member'",
      )
      .run();
    await expect(
      tenancy.promoteMember(proofActor, "review_team", {
        targetUserId: "review_member",
        reauthIntentId: receipt.reauthIntentId,
      }),
    ).rejects.toBeInstanceOf(TenancyError);
    expect(
      await database
        .prepare(
          "SELECT COUNT(*) FROM membership WHERE workspace_id='review_team' AND user_id='review_member'",
        )
        .first("COUNT(*)"),
    ).toBe(0);
  });
}

it("confirmation checks pending expiry against SQLite even if the request clock is behind", async () => {
  const { database, actor } = await fixture();
  const tenancy = createTenancyPersistence(database);
  const receipt = await tenancy.createReauthIntent(actor, {
    workspaceId: "review_team",
    action: "promote",
    targetUserId: "review_member",
  });
  const now = Date.now();
  await database
    .prepare(
      "INSERT INTO session (id,token,userId,expiresAt,createdAt,updatedAt) VALUES ('review_proof','synthetic_proof_token','review_owner',?,?,?)",
    )
    .bind(now + 60_000, now, now)
    .run();
  await database
    .prepare("UPDATE reauth_intent SET expires_at=? WHERE id=?")
    .bind(now - 1000, receipt.reauthIntentId)
    .run();
  vi.spyOn(Date, "now").mockReturnValue(now - 2000);
  expect(
    await tenancy.confirmReauthIntent(
      receipt.reauthIntentId,
      actor.githubAccountId,
      actor.id,
      "review_proof",
    ),
  ).toBe(false);
  expect(
    await database
      .prepare(
        "SELECT confirmed_at,proof_session_id FROM reauth_intent WHERE id=?",
      )
      .bind(receipt.reauthIntentId)
      .first(),
  ).toEqual({ confirmed_at: null, proof_session_id: null });
});
