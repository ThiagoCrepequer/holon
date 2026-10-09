import type { AdmittedUser } from "@holon/contracts/dashboard";
import {
  applyD1Migrations,
  env,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { afterEach, expect, it } from "vitest";

import { createInvitationPersistence } from "../src/invitations.server.js";
const bindings = env as {
  IDENTITY_DB: D1Database;
  IDENTITY_MIGRATIONS: D1Migration[];
};
const db = bindings.IDENTITY_DB;
const actor: AdmittedUser = {
  id: "owner",
  name: "Synthetic",
  sessionId: "session",
  githubAccountId: "123",
  expiresAt: "2099-01-01T00:00:00.000Z",
};
afterEach(async () => reset());
async function setup() {
  await applyD1Migrations(db, bindings.IDENTITY_MIGRATIONS);
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('owner','Synthetic','owner@example.invalid',1,?,?)",
      )
      .bind(now, now),
    db
      .prepare(
        "INSERT INTO account(id,userId,providerId,accountId,createdAt,updatedAt) VALUES('account','owner','github','123',?,?)",
      )
      .bind(now, now),
    db
      .prepare(
        "INSERT INTO session(id,userId,token,createdAt,updatedAt,expiresAt) VALUES('session','owner','synthetic',?,?,?)",
      )
      .bind(now, now, now + 3600000),
    db
      .prepare(
        "INSERT INTO workspace(id,type,name,created_at,updated_at) VALUES('team','team','Synthetic',?,?)",
      )
      .bind(now, now),
    db
      .prepare(
        "INSERT INTO membership(workspace_id,user_id,role,created_at,updated_at) VALUES('team','owner','owner',?,?)",
      )
      .bind(now, now),
  ]);
  return createInvitationPersistence(db);
}
it("records invitation and one durable delivery intent under concurrent replay", async () => {
  const invites = await setup();
  const input = {
    operationId: "op",
    email: "target@example.invalid",
    locale: "en" as const,
  };
  const results = await Promise.all([
    invites.create(actor, "team", input),
    invites.create(actor, "team", input),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(
    await db.prepare("SELECT COUNT(*) AS n FROM workspace_invitation").first(),
  ).toEqual({ n: 1 });
  expect(
    await db
      .prepare("SELECT COUNT(*) AS n FROM invitation_delivery_intent")
      .first(),
  ).toEqual({ n: 1 });
  await expect(
    invites.create(actor, "team", { ...input, email: "other@example.invalid" }),
  ).rejects.toMatchObject({ code: "conflict" });
});
it("accepts a verified non-primary target and never recreates a removed membership", async () => {
  const invites = await setup();
  const invitation = await invites.create(actor, "team", {
    operationId: "op",
    email: "target@example.invalid",
    locale: "en",
  });
  const proof = {
    accountId: "account",
    generation: 1,
    verifiedEmails: ["target@example.invalid"],
  };
  expect(await invites.accept(actor, invitation.id, proof)).toEqual({
    status: "accepted",
    membershipActive: true,
  });
  expect(
    await db
      .prepare("SELECT accepted_by,state FROM workspace_invitation")
      .first(),
  ).toEqual({ accepted_by: "owner", state: "accepted" });
});
it("revoked session and wrong recipient leave both authorities untouched", async () => {
  const invites = await setup();
  const invitation = await invites.create(actor, "team", {
    operationId: "op",
    email: "target@example.invalid",
    locale: "en",
  });
  await expect(
    invites.accept(actor, invitation.id, {
      accountId: "account",
      generation: 1,
      verifiedEmails: ["other@example.invalid"],
    }),
  ).rejects.toMatchObject({ code: "denied" });
  await db.prepare("DELETE FROM session").run();
  await expect(
    invites.create(actor, "team", {
      operationId: "second",
      email: "target@example.invalid",
      locale: "en",
    }),
  ).rejects.toMatchObject({ code: "denied" });
  expect(
    await db.prepare("SELECT COUNT(*) AS n FROM workspace_invitation").first(),
  ).toEqual({ n: 1 });
});
