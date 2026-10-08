import type { AdmittedUser } from "@holon/contracts/dashboard";
import {
  applyD1Migrations,
  env,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

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

async function setupFixture() {
  const database = bindings.IDENTITY_DB;
  await applyD1Migrations(database, bindings.IDENTITY_MIGRATIONS);
  const now = Date.now();

  for (const id of ["alice", "bob", "carol", "stranger"]) {
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
        "INSERT INTO account (id,accountId,providerId,userId,createdAt,updatedAt) VALUES ('acc_alice','gh_alice','github','alice',?,?)",
      )
      .bind(now, now),
    database
      .prepare(
        "INSERT INTO account (id,accountId,providerId,userId,createdAt,updatedAt) VALUES ('acc_bob','gh_bob','github','bob',?,?)",
      )
      .bind(now, now),
    database
      .prepare(
        "INSERT INTO account (id,accountId,providerId,userId,createdAt,updatedAt) VALUES ('acc_carol','gh_carol','github','carol',?,?)",
      )
      .bind(now, now),
    database
      .prepare(
        "INSERT INTO session (id,token,userId,expiresAt,createdAt,updatedAt) VALUES ('sess_alice','tok_alice','alice',?,?,?)",
      )
      .bind(now + 600_000, now, now),
    database
      .prepare(
        "INSERT INTO session (id,token,userId,expiresAt,createdAt,updatedAt) VALUES ('sess_bob','tok_bob','bob',?,?,?)",
      )
      .bind(now + 600_000, now, now),
    database
      .prepare(
        "INSERT INTO session (id,token,userId,expiresAt,createdAt,updatedAt) VALUES ('sess_carol','tok_carol','carol',?,?,?)",
      )
      .bind(now + 600_000, now, now),
    database
      .prepare(
        "INSERT INTO workspace (id,type,name,personal_user_id,created_at,updated_at) VALUES ('ws_team','team','Test Team',NULL,?,?)",
      )
      .bind(now, now),
    database
      .prepare(
        "INSERT INTO workspace (id,type,name,personal_user_id,created_at,updated_at) VALUES ('ws_personal','personal','Personal Alice','alice',?,?)",
      )
      .bind(now, now),
    database
      .prepare(
        "INSERT INTO membership (workspace_id,user_id,role,created_at,updated_at) VALUES ('ws_team','alice','owner',?,?)",
      )
      .bind(now, now),
    database
      .prepare(
        "INSERT INTO membership (workspace_id,user_id,role,created_at,updated_at) VALUES ('ws_team','bob','owner',?,?)",
      )
      .bind(now, now),
    database
      .prepare(
        "INSERT INTO membership (workspace_id,user_id,role,created_at,updated_at) VALUES ('ws_team','carol','member',?,?)",
      )
      .bind(now, now),
    database
      .prepare(
        "INSERT INTO membership (workspace_id,user_id,role,created_at,updated_at) VALUES ('ws_personal','alice','owner',?,?)",
      )
      .bind(now, now),
  ]);

  const alice: AdmittedUser = {
    id: "alice",
    name: "Alice",
    githubAccountId: "gh_alice",
    sessionId: "sess_alice",
    expiresAt: new Date(now + 600_000).toISOString(),
  };

  const bob: AdmittedUser = {
    id: "bob",
    name: "Bob",
    githubAccountId: "gh_bob",
    sessionId: "sess_bob",
    expiresAt: new Date(now + 600_000).toISOString(),
  };

  const carol: AdmittedUser = {
    id: "carol",
    name: "Carol",
    githubAccountId: "gh_carol",
    sessionId: "sess_carol",
    expiresAt: new Date(now + 600_000).toISOString(),
  };

  const tenancy = createTenancyPersistence(database);

  async function issueProof(
    actor: AdmittedUser,
    action: "promote" | "demote" | "remove" | "leave",
    targetUserId: string,
    workspaceId = "ws_team",
  ) {
    const receipt = await tenancy.createReauthIntent(actor, {
      workspaceId,
      action,
      targetUserId,
    });
    const proofSessionId = `proof_${crypto.randomUUID().slice(0, 8)}`;
    const proofNow = Date.now();
    await database
      .prepare(
        "INSERT INTO session (id,token,userId,expiresAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?)",
      )
      .bind(
        proofSessionId,
        `tok_${proofSessionId}`,
        actor.id,
        proofNow + 600_000,
        proofNow,
        proofNow,
      )
      .run();

    const confirmed = await tenancy.confirmReauthIntent(
      receipt.reauthIntentId,
      actor.githubAccountId,
      actor.id,
      proofSessionId,
    );
    expect(confirmed).toBe(true);

    const proofActor: AdmittedUser = {
      ...actor,
      sessionId: proofSessionId,
      expiresAt: new Date(proofNow + 600_000).toISOString(),
    };

    return { receipt, proofActor, proofSessionId };
  }

  return { database, alice, bob, carol, tenancy, issueProof };
}

describe("Governance Ports & Invariants", () => {
  describe("readPendingReauthContext", () => {
    it("returns null when caller session or user does not match intent", async () => {
      const { alice, bob, tenancy } = await setupFixture();
      const receipt = await tenancy.createReauthIntent(alice, {
        workspaceId: "ws_team",
        action: "promote",
        targetUserId: "carol",
      });

      const mismatch = await tenancy.readPendingReauthContext(
        receipt.reauthIntentId,
        bob.sessionId,
        bob.id,
      );
      expect(mismatch).toBeNull();
    });

    it("returns pending context when session matches and is active", async () => {
      const { alice, tenancy } = await setupFixture();
      const receipt = await tenancy.createReauthIntent(alice, {
        workspaceId: "ws_team",
        action: "promote",
        targetUserId: "carol",
      });

      const context = await tenancy.readPendingReauthContext(
        receipt.reauthIntentId,
        alice.sessionId,
        alice.id,
      );
      expect(context).not.toBeNull();
      expect(context?.reauthIntentId).toBe(receipt.reauthIntentId);
      expect(context?.originalSessionId).toBe(alice.sessionId);
      expect(context?.expectedAccountId).toBe(alice.githubAccountId);
      expect(context?.userId).toBe(alice.id);
    });

    it("returns null when intent does not exist or has expired", async () => {
      const { database, alice, tenancy } = await setupFixture();
      const receipt = await tenancy.createReauthIntent(alice, {
        workspaceId: "ws_team",
        action: "promote",
        targetUserId: "carol",
      });

      await database
        .prepare("UPDATE reauth_intent SET expires_at = ? WHERE id = ?")
        .bind(Date.now() - 1000, receipt.reauthIntentId)
        .run();

      const expired = await tenancy.readPendingReauthContext(
        receipt.reauthIntentId,
        alice.sessionId,
        alice.id,
      );
      expect(expired).toBeNull();
    });
  });

  describe("promoteMember", () => {
    it("successfully promotes member to owner with valid reauth proof", async () => {
      const { alice, tenancy, issueProof } = await setupFixture();
      const { receipt, proofActor } = await issueProof(
        alice,
        "promote",
        "carol",
      );

      const result = await tenancy.promoteMember(proofActor, "ws_team", {
        targetUserId: "carol",
        reauthIntentId: receipt.reauthIntentId,
      });

      expect(result.role).toBe("owner");
      expect(result.userId).toBe("carol");
    });

    it("denies promotion on personal workspace", async () => {
      const { alice, tenancy } = await setupFixture();
      await expect(
        tenancy.promoteMember(alice, "ws_personal", {
          targetUserId: "carol",
          reauthIntentId: "intent_fake",
        }),
      ).rejects.toMatchObject({ code: "governance_denied" });
    });

    it("denies promotion when actor is a member, not owner", async () => {
      const { carol, tenancy } = await setupFixture();
      await expect(
        tenancy.promoteMember(carol, "ws_team", {
          targetUserId: "carol",
          reauthIntentId: "intent_fake",
        }),
      ).rejects.toMatchObject({ code: "governance_denied" });
    });

    it("rejects promotion when target member is not found", async () => {
      const { alice, tenancy } = await setupFixture();
      await expect(
        tenancy.promoteMember(alice, "ws_team", {
          targetUserId: "stranger",
          reauthIntentId: "intent_fake",
        }),
      ).rejects.toMatchObject({ code: "member_not_found" });
    });

    it("rejects promotion when target is already an owner", async () => {
      const { alice, tenancy } = await setupFixture();
      await expect(
        tenancy.promoteMember(alice, "ws_team", {
          targetUserId: "bob",
          reauthIntentId: "intent_fake",
        }),
      ).rejects.toMatchObject({ code: "invalid_role_transition" });
    });

    it("rejects promotion if reauth intent action does not match", async () => {
      const { alice, tenancy, issueProof } = await setupFixture();
      const { receipt, proofActor } = await issueProof(alice, "demote", "bob");

      await expect(
        tenancy.promoteMember(proofActor, "ws_team", {
          targetUserId: "carol",
          reauthIntentId: receipt.reauthIntentId,
        }),
      ).rejects.toMatchObject({ code: "governance_denied" });
    });
  });

  describe("demoteMember", () => {
    it("successfully demotes an owner to member when another owner exists", async () => {
      const { alice, tenancy, issueProof } = await setupFixture();
      const { receipt, proofActor } = await issueProof(alice, "demote", "bob");

      const result = await tenancy.demoteMember(proofActor, "ws_team", {
        targetUserId: "bob",
        reauthIntentId: receipt.reauthIntentId,
      });

      expect(result.role).toBe("member");
      expect(result.userId).toBe("bob");
    });

    it("rejects demotion on personal workspace", async () => {
      const { alice, tenancy } = await setupFixture();
      await expect(
        tenancy.demoteMember(alice, "ws_personal", {
          targetUserId: "alice",
          reauthIntentId: "intent_fake",
        }),
      ).rejects.toMatchObject({ code: "governance_denied" });
    });

    it("rejects demotion when target is not a member", async () => {
      const { alice, tenancy } = await setupFixture();
      await expect(
        tenancy.demoteMember(alice, "ws_team", {
          targetUserId: "stranger",
          reauthIntentId: "intent_fake",
        }),
      ).rejects.toMatchObject({ code: "member_not_found" });
    });

    it("rejects demotion when target is already a member", async () => {
      const { alice, tenancy } = await setupFixture();
      await expect(
        tenancy.demoteMember(alice, "ws_team", {
          targetUserId: "carol",
          reauthIntentId: "intent_fake",
        }),
      ).rejects.toMatchObject({ code: "invalid_role_transition" });
    });

    it("prevents demoting the last owner of a team workspace", async () => {
      const { database, alice, tenancy, issueProof } = await setupFixture();
      await database
        .prepare(
          "DELETE FROM membership WHERE workspace_id = 'ws_team' AND user_id = 'bob'",
        )
        .run();

      const { receipt, proofActor } = await issueProof(
        alice,
        "demote",
        "alice",
      );

      await expect(
        tenancy.demoteMember(proofActor, "ws_team", {
          targetUserId: "alice",
          reauthIntentId: receipt.reauthIntentId,
        }),
      ).rejects.toMatchObject({ code: "governance_denied" });
    });
  });

  describe("removeMember", () => {
    it("successfully removes a member from a team workspace", async () => {
      const { database, alice, tenancy, issueProof } = await setupFixture();
      const { receipt, proofActor } = await issueProof(
        alice,
        "remove",
        "carol",
      );

      const result = await tenancy.removeMember(proofActor, "ws_team", {
        targetUserId: "carol",
        reauthIntentId: receipt.reauthIntentId,
      });

      expect(result.removed).toBe(true);
      const remaining = await database
        .prepare(
          "SELECT COUNT(*) FROM membership WHERE workspace_id = 'ws_team' AND user_id = 'carol'",
        )
        .first("COUNT(*)");
      expect(remaining).toBe(0);
    });

    it("successfully removes another owner when multiple owners exist", async () => {
      const { database, alice, tenancy, issueProof } = await setupFixture();
      const { receipt, proofActor } = await issueProof(alice, "remove", "bob");

      const result = await tenancy.removeMember(proofActor, "ws_team", {
        targetUserId: "bob",
        reauthIntentId: receipt.reauthIntentId,
      });

      expect(result.removed).toBe(true);
      const remaining = await database
        .prepare(
          "SELECT COUNT(*) FROM membership WHERE workspace_id = 'ws_team' AND user_id = 'bob'",
        )
        .first("COUNT(*)");
      expect(remaining).toBe(0);
    });

    it("denies removal on personal workspace", async () => {
      const { alice, tenancy } = await setupFixture();
      await expect(
        tenancy.removeMember(alice, "ws_personal", {
          targetUserId: "alice",
          reauthIntentId: "intent_fake",
        }),
      ).rejects.toMatchObject({ code: "governance_denied" });
    });

    it("rejects removal when target is not a member", async () => {
      const { alice, tenancy } = await setupFixture();
      await expect(
        tenancy.removeMember(alice, "ws_team", {
          targetUserId: "stranger",
          reauthIntentId: "intent_fake",
        }),
      ).rejects.toMatchObject({ code: "member_not_found" });
    });

    it("prevents removing the last owner of a team workspace", async () => {
      const { database, alice, tenancy, issueProof } = await setupFixture();
      await database
        .prepare(
          "DELETE FROM membership WHERE workspace_id = 'ws_team' AND user_id = 'bob'",
        )
        .run();

      const { receipt, proofActor } = await issueProof(
        alice,
        "remove",
        "alice",
      );

      await expect(
        tenancy.removeMember(proofActor, "ws_team", {
          targetUserId: "alice",
          reauthIntentId: receipt.reauthIntentId,
        }),
      ).rejects.toMatchObject({ code: "governance_denied" });
    });
  });

  describe("leaveWorkspace", () => {
    it("successfully leaves workspace when other owners exist", async () => {
      const { database, alice, tenancy, issueProof } = await setupFixture();
      const { receipt, proofActor } = await issueProof(alice, "leave", "alice");

      const result = await tenancy.leaveWorkspace(proofActor, "ws_team", {
        reauthIntentId: receipt.reauthIntentId,
      });

      expect(result.left).toBe(true);
      const remaining = await database
        .prepare(
          "SELECT COUNT(*) FROM membership WHERE workspace_id = 'ws_team' AND user_id = 'alice'",
        )
        .first("COUNT(*)");
      expect(remaining).toBe(0);
    });

    it("member can leave workspace with proof", async () => {
      const { database, carol, tenancy, issueProof } = await setupFixture();
      const { receipt, proofActor } = await issueProof(carol, "leave", "carol");

      const result = await tenancy.leaveWorkspace(proofActor, "ws_team", {
        reauthIntentId: receipt.reauthIntentId,
      });

      expect(result.left).toBe(true);
      const remaining = await database
        .prepare(
          "SELECT COUNT(*) FROM membership WHERE workspace_id = 'ws_team' AND user_id = 'carol'",
        )
        .first("COUNT(*)");
      expect(remaining).toBe(0);
    });

    it("denies leaving personal workspace", async () => {
      const { alice, tenancy } = await setupFixture();
      await expect(
        tenancy.leaveWorkspace(alice, "ws_personal", {
          reauthIntentId: "intent_fake",
        }),
      ).rejects.toMatchObject({ code: "governance_denied" });
    });

    it("prevents the last owner from leaving the workspace", async () => {
      const { database, alice, tenancy, issueProof } = await setupFixture();
      await database
        .prepare(
          "DELETE FROM membership WHERE workspace_id = 'ws_team' AND user_id = 'bob'",
        )
        .run();

      const { receipt, proofActor } = await issueProof(alice, "leave", "alice");

      await expect(
        tenancy.leaveWorkspace(proofActor, "ws_team", {
          reauthIntentId: receipt.reauthIntentId,
        }),
      ).rejects.toMatchObject({ code: "governance_denied" });
    });
  });

  describe("intent bindings & invariants", () => {
    it("rejects using an intent for a different workspace", async () => {
      const { database, alice, tenancy, issueProof } = await setupFixture();
      const now = Date.now();
      await database
        .prepare(
          "INSERT INTO workspace (id,type,name,personal_user_id,created_at,updated_at) VALUES ('ws_other','team','Other',NULL,?,?)",
        )
        .bind(now, now)
        .run();
      await database
        .prepare(
          "INSERT INTO membership (workspace_id,user_id,role,created_at,updated_at) VALUES ('ws_other','alice','owner',?,?)",
        )
        .bind(now, now)
        .run();
      await database
        .prepare(
          "INSERT INTO membership (workspace_id,user_id,role,created_at,updated_at) VALUES ('ws_other','carol','member',?,?)",
        )
        .bind(now, now)
        .run();

      const { receipt, proofActor } = await issueProof(
        alice,
        "promote",
        "carol",
        "ws_team",
      );

      await expect(
        tenancy.promoteMember(proofActor, "ws_other", {
          targetUserId: "carol",
          reauthIntentId: receipt.reauthIntentId,
        }),
      ).rejects.toMatchObject({ code: "governance_denied" });
    });

    it("rejects reusing a consumed intent", async () => {
      const { alice, tenancy, issueProof } = await setupFixture();
      const { receipt, proofActor } = await issueProof(
        alice,
        "promote",
        "carol",
      );

      await tenancy.promoteMember(proofActor, "ws_team", {
        targetUserId: "carol",
        reauthIntentId: receipt.reauthIntentId,
      });

      await expect(
        tenancy.promoteMember(proofActor, "ws_team", {
          targetUserId: "carol",
          reauthIntentId: receipt.reauthIntentId,
        }),
      ).rejects.toBeInstanceOf(TenancyError);
    });
  });

  describe("additional role & branch validations", () => {
    it("denies demoting when actor is a member, not owner", async () => {
      const { carol, tenancy } = await setupFixture();
      await expect(
        tenancy.demoteMember(carol, "ws_team", {
          targetUserId: "bob",
          reauthIntentId: "intent_fake",
        }),
      ).rejects.toMatchObject({ code: "governance_denied" });
    });

    it("denies removing when actor is a member, not owner", async () => {
      const { carol, tenancy } = await setupFixture();
      await expect(
        tenancy.removeMember(carol, "ws_team", {
          targetUserId: "bob",
          reauthIntentId: "intent_fake",
        }),
      ).rejects.toMatchObject({ code: "governance_denied" });
    });

    it("denies leaving when actor is not a member of the workspace", async () => {
      const { alice, tenancy } = await setupFixture();
      const nonMemberActor: AdmittedUser = {
        ...alice,
        id: "stranger",
      };
      await expect(
        tenancy.leaveWorkspace(nonMemberActor, "ws_team", {
          reauthIntentId: "intent_fake",
        }),
      ).rejects.toMatchObject({ code: "governance_denied" });
    });

    it("createReauthIntent rejects non-team workspaces and non-owners", async () => {
      const { alice, carol, tenancy } = await setupFixture();
      await expect(
        tenancy.createReauthIntent(alice, {
          workspaceId: "ws_nonexistent",
          action: "promote",
          targetUserId: "bob",
        }),
      ).rejects.toMatchObject({ code: "governance_denied" });

      await expect(
        tenancy.createReauthIntent(alice, {
          workspaceId: "ws_personal",
          action: "promote",
          targetUserId: "bob",
        }),
      ).rejects.toMatchObject({ code: "governance_denied" });

      await expect(
        tenancy.createReauthIntent(carol, {
          workspaceId: "ws_team",
          action: "promote",
          targetUserId: "bob",
        }),
      ).rejects.toMatchObject({ code: "governance_denied" });

      await expect(
        tenancy.createReauthIntent(alice, {
          workspaceId: "ws_team",
          action: "leave",
          targetUserId: "bob",
        }),
      ).rejects.toMatchObject({ code: "governance_denied" });

      await expect(
        tenancy.createReauthIntent(alice, {
          workspaceId: "ws_team",
          action: "demote",
          targetUserId: "carol",
        }),
      ).rejects.toMatchObject({ code: "invalid_role_transition" });

      await expect(
        tenancy.createReauthIntent(alice, {
          workspaceId: "ws_team",
          action: "promote",
          targetUserId: "bob",
        }),
      ).rejects.toMatchObject({ code: "invalid_role_transition" });

      await expect(
        tenancy.createReauthIntent(alice, {
          workspaceId: "ws_team",
          action: "promote",
          targetUserId: "stranger",
        }),
      ).rejects.toMatchObject({ code: "member_not_found" });

      const removeReceipt = await tenancy.createReauthIntent(alice, {
        workspaceId: "ws_team",
        action: "remove",
        targetUserId: "carol",
      });
      expect(removeReceipt.reauthIntentId).toBeTruthy();
    });
  });

  describe("session persistence branch coverage", () => {
    it("readSession and deleteExpiredSession handle missing and unexpired sessions", async () => {
      const { database, alice } = await setupFixture();
      const sessionPersistence = (
        await import("../src/session.server.js")
      ).createSessionPersistence(database);

      const found = await sessionPersistence.readSession(alice.sessionId);
      expect(found).not.toBeNull();

      const notFound = await sessionPersistence.readSession(
        "nonexistent_session",
      );
      expect(notFound).toBeNull();

      const notFoundWithUser = await sessionPersistence.readSession(
        "nonexistent_session",
        alice.id,
      );
      expect(notFoundWithUser).toBeNull();

      const deleted = await sessionPersistence.deleteExpiredSession(
        alice.sessionId,
        0,
      );
      expect(deleted).toBe(false);
    });

    it("renewSession returns denied when row is expired or missing", async () => {
      const { database, alice } = await setupFixture();
      const sessionPersistence = (
        await import("../src/session.server.js")
      ).createSessionPersistence(database);

      const missing = await sessionPersistence.renewSession(
        "missing",
        alice.id,
        Date.now(),
        Date.now() + 1000,
        Date.now(),
      );
      expect(missing.status).toBe("denied");

      const now = Date.now();
      await database
        .prepare("UPDATE session SET expiresAt = ? WHERE id = ?")
        .bind(now - 1000, alice.sessionId)
        .run();

      const expired = await sessionPersistence.renewSession(
        alice.sessionId,
        alice.id,
        now,
        now + 1000,
        now,
      );
      expect(expired.status).toBe("denied");
    });

    it("renewSession returns denied when changes is 0 and current is older than newExpiresAtMs", async () => {
      const { database, alice } = await setupFixture();
      const now = Date.now();
      await database
        .prepare("UPDATE session SET expiresAt = ? WHERE id = ?")
        .bind(now + 50_000, alice.sessionId)
        .run();

      const proxyDb = new Proxy(database, {
        get(target, prop) {
          if (prop === "prepare") {
            return (sql: string) => {
              const stmt = database.prepare(sql);
              if (sql.startsWith("UPDATE session SET expiresAt")) {
                return new Proxy(stmt, {
                  get(t, p) {
                    if (p === "bind") {
                      return (...args: unknown[]) => {
                        const bound = t.bind(...args);
                        return new Proxy(bound, {
                          get(b, bp) {
                            if (bp === "run")
                              return async () => ({ meta: { changes: 0 } });
                            const val = Reflect.get(b, bp);
                            return typeof val === "function"
                              ? val.bind(b)
                              : val;
                          },
                        });
                      };
                    }
                    if (p === "run")
                      return async () => ({ meta: { changes: 0 } });
                    const val = Reflect.get(t, p);
                    return typeof val === "function" ? val.bind(t) : val;
                  },
                });
              }
              return stmt;
            };
          }
          const val = Reflect.get(target, prop);
          return typeof val === "function" ? val.bind(target) : val;
        },
      });

      const proxyPersistence = (
        await import("../src/session.server.js")
      ).createSessionPersistence(proxyDb);
      const res = await proxyPersistence.renewSession(
        alice.sessionId,
        alice.id,
        now,
        now + 100_000,
        now,
      );
      expect(res.status).toBe("denied");
    });

    it("mutation reports command_unknown when batch does 0 changes but memberships still exist", async () => {
      const { database, alice, issueProof } = await setupFixture();
      const { receipt, proofActor } = await issueProof(
        alice,
        "promote",
        "carol",
      );

      const proxyDb = new Proxy(database, {
        get(target, prop) {
          if (prop === "batch") {
            return async (statements: D1PreparedStatement[]) => {
              const realResults = await database.batch(statements);
              return [
                realResults[0],
                realResults[1],
                { meta: { changes: 0 }, results: [], success: true },
                realResults[3],
              ];
            };
          }
          const val = Reflect.get(target, prop);
          return typeof val === "function" ? val.bind(target) : val;
        },
      });

      await expect(
        createTenancyPersistence(proxyDb).promoteMember(proofActor, "ws_team", {
          targetUserId: "carol",
          reauthIntentId: receipt.reauthIntentId,
        }),
      ).rejects.toMatchObject({ code: "command_unknown" });
    });
  });
});
