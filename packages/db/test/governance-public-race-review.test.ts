import type { AdmittedUser } from "@holon/contracts/dashboard";
import {
  applyD1Migrations,
  env,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { afterEach, expect, it } from "vitest";

import {
  createTenancyPersistence,
  TenancyError,
} from "../src/identity.server.js";

const bindings = env as {
  IDENTITY_DB: D1Database;
  IDENTITY_MIGRATIONS: D1Migration[];
};
const database = bindings.IDENTITY_DB;
afterEach(async () => {
  await reset();
});
type Action = "leave" | "demote" | "remove";

async function fixture() {
  await applyD1Migrations(database, bindings.IDENTITY_MIGRATIONS);
  const now = Date.now();
  const actors: AdmittedUser[] = [];
  for (const name of ["alice", "bob"]) {
    const id = `race_${name}`;
    const sessionId = `race_session_${name}`;
    const subject = `race_subject_${name}`;
    await database.batch([
      database
        .prepare(
          "INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,?,?)",
        )
        .bind(id, `Synthetic ${name}`, `${name}@example.invalid`, now, now),
      database
        .prepare(
          "INSERT INTO account (id,accountId,providerId,userId,createdAt,updatedAt) VALUES (?,?,'github',?,?,?)",
        )
        .bind(`race_account_${name}`, subject, id, now, now),
      database
        .prepare(
          "INSERT INTO session (id,token,userId,expiresAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?)",
        )
        .bind(sessionId, `synthetic_race_${name}`, id, now + 600_000, now, now),
    ]);
    actors.push({
      id,
      name: `Synthetic ${name}`,
      sessionId,
      githubAccountId: subject,
      expiresAt: new Date(now + 600_000).toISOString(),
    });
  }
  const alice = actors[0];
  const bob = actors[1];
  if (!alice || !bob) throw new Error("Synthetic race fixture missing owner");
  const tenancy = createTenancyPersistence(database);
  const team = await tenancy.createTeamWorkspace(alice, {
    name: "Race team",
    operationId: "race_create_team",
  });
  await database
    .prepare(
      "INSERT INTO membership (workspace_id,user_id,role,created_at,updated_at) VALUES (?,?,'owner',?,?)",
    )
    .bind(team.workspace.id, bob.id, now, now)
    .run();
  async function prove(actor: AdmittedUser, action: Action) {
    const receipt = await tenancy.createReauthIntent(actor, {
      workspaceId: team.workspace.id,
      action,
      targetUserId: actor.id,
    });
    const proofSessionId = `proof_${actor.id}`;
    // Controlled callback issuance; native issuer/subject validation has separate Workerd tests.
    await database
      .prepare(
        "INSERT INTO session (id,token,userId,expiresAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?)",
      )
      .bind(
        proofSessionId,
        `synthetic_${proofSessionId}`,
        actor.id,
        now + 600_000,
        now,
        now,
      )
      .run();
    expect(
      await tenancy.confirmReauthIntent(
        receipt.reauthIntentId,
        actor.githubAccountId,
        actor.id,
        proofSessionId,
      ),
    ).toBe(true);
    return { actor: { ...actor, sessionId: proofSessionId }, action, receipt };
  }
  function execute(proof: Awaited<ReturnType<typeof prove>>) {
    const input = {
      reauthIntentId: proof.receipt.reauthIntentId,
      targetUserId: proof.actor.id,
    };
    if (proof.action === "leave")
      return tenancy.leaveWorkspace(proof.actor, team.workspace.id, {
        reauthIntentId: input.reauthIntentId,
      });
    if (proof.action === "remove")
      return tenancy.removeMember(proof.actor, team.workspace.id, input);
    return tenancy.demoteMember(proof.actor, team.workspace.id, input);
  }
  return { alice, bob, team, prove, execute };
}

for (const actions of [
  ["leave", "leave"],
  ["demote", "demote"],
  ["remove", "remove"],
  ["leave", "demote"],
  ["remove", "leave"],
] as const) {
  it(`two final owners racing ${actions.join("/")} preserve one owner and consume only the winning proof`, async () => {
    const f = await fixture();
    const proofs = [
      await f.prove(f.alice, actions[0]),
      await f.prove(f.bob, actions[1]),
    ];
    const outcomes = await Promise.allSettled(proofs.map(f.execute));
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(1);
    expect(
      await database
        .prepare(
          "SELECT COUNT(*) FROM membership WHERE workspace_id=? AND role='owner'",
        )
        .bind(f.team.workspace.id)
        .first("COUNT(*)"),
    ).toBe(1);
    for (const [index, proof] of proofs.entries()) {
      const outcome = outcomes[index];
      expect(outcome).toBeDefined();
      const consumed = await database
        .prepare("SELECT consumed_at FROM reauth_intent WHERE id=?")
        .bind(proof.receipt.reauthIntentId)
        .first("consumed_at");
      if (outcome?.status === "fulfilled") expect(consumed).not.toBeNull();
      else {
        expect(consumed).toBeNull();
        if (outcome?.status === "rejected")
          expect(outcome.reason).toBeInstanceOf(TenancyError);
      }
    }
    expect(
      await database
        .prepare("SELECT COUNT(*) FROM tenancy_mutation_guard")
        .first("COUNT(*)"),
    ).toBe(0);
  });
}
