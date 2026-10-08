import { reset } from "cloudflare:test";
import { afterEach, beforeEach, expect, it } from "vitest";

import { createInvitationPersistence } from "../src/invitations.server.js";
import {
  db,
  owner,
  target,
  outsider,
  seedCollaboration,
} from "./support/collaboration-fixture.js";
const invites = createInvitationPersistence(db);
const input = {
  operationId: "op",
  email: "target@example.invalid",
  locale: "en" as const,
};
const recipient = {
  accountId: "target_account",
  generation: 1,
  verifiedEmails: ["target@example.invalid"],
};
beforeEach(seedCollaboration);
afterEach(async () => reset());
it("acceptance is atomic, member only and replay cannot restore removed membership", async () => {
  const invitation = await invites.create(owner, "team", input);
  expect(await invites.accept(target, invitation.id, recipient)).toEqual({
    status: "accepted",
    membershipActive: true,
  });
  expect(
    await db
      .prepare(
        "SELECT role FROM membership WHERE workspace_id='team' AND user_id='target'",
      )
      .first(),
  ).toEqual({ role: "member" });
  await db
    .prepare(
      "DELETE FROM membership WHERE workspace_id='team' AND user_id='target'",
    )
    .run();
  expect(await invites.accept(target, invitation.id, recipient)).toEqual({
    status: "accepted",
    membershipActive: false,
  });
  expect(
    await db.prepare("SELECT state FROM invitation_delivery_intent").first(),
  ).toEqual({ state: "canceled" });
  await expect(
    invites.accept(outsider, invitation.id, {
      accountId: "outsider_account",
      generation: 1,
      verifiedEmails: recipient.verifiedEmails,
    }),
  ).rejects.toMatchObject({ code: "denied" });
});
it.each(["canceled", "expired"] as const)(
  "terminal %s invitations do not admit recipients",
  async (state) => {
    const invitation = await invites.create(owner, "team", input);
    if (state === "canceled")
      expect((await invites.cancel(owner, "team", invitation.id)).state).toBe(
        "canceled",
      );
    else {
      await db.prepare("UPDATE workspace_invitation SET expires_at=0").run();
      expect((await invites.list(owner, "team"))[0]?.state).toBe("expired");
      await invites.expireDue();
    }
    await expect(
      invites.accept(target, invitation.id, recipient),
    ).rejects.toMatchObject({ code: "denied" });
    expect(
      await db
        .prepare("SELECT COUNT(*) AS n FROM membership WHERE user_id='target'")
        .first(),
    ).toEqual({ n: 0 });
    expect(
      await db.prepare("SELECT state FROM invitation_delivery_intent").first(),
    ).toEqual({ state: "canceled" });
  },
);
it("cancel versus accept has one valid terminal transition", async () => {
  const invitation = await invites.create(owner, "team", input);
  await Promise.allSettled([
    invites.cancel(owner, "team", invitation.id),
    invites.accept(target, invitation.id, recipient),
  ]);
  const final = await db
    .prepare("SELECT state FROM workspace_invitation")
    .first<{ state: string }>();
  const membership = await db
    .prepare("SELECT COUNT(*) AS n FROM membership WHERE user_id='target'")
    .first<{ n: number }>();
  expect(["accepted", "canceled"]).toContain(final?.state);
  expect(membership?.n).toBe(final?.state === "accepted" ? 1 : 0);
});
it.each(["member", "personal", "foreign", "revoked", "missing"] as const)(
  "rejects %s authority with no partial intention",
  async (kind) => {
    if (kind === "member")
      await db
        .prepare(
          "UPDATE membership SET role='member' WHERE workspace_id='team'",
        )
        .run()
        .catch(() => {});
    // Keep last-owner invariant: use an actual non-owner instead.
    const actor = kind === "member" ? target : owner;
    if (kind === "member")
      await db
        .prepare("INSERT INTO membership VALUES('team','target','member',0,0)")
        .run();
    if (kind === "revoked")
      await db
        .prepare("DELETE FROM session WHERE id=?")
        .bind(owner.sessionId)
        .run();
    const workspace =
      kind === "personal"
        ? "personal"
        : kind === "foreign"
          ? "other"
          : kind === "missing"
            ? "missing"
            : "team";
    await expect(invites.create(actor, workspace, input)).rejects.toMatchObject(
      { code: "denied" },
    );
    expect(
      await db
        .prepare("SELECT COUNT(*) AS n FROM invitation_delivery_intent")
        .first(),
    ).toEqual({ n: 0 });
  },
);
it("rate budget is atomic across workers and replay does not consume another send", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, (_, i) =>
      invites.create(owner, "team", { ...input, operationId: `op_${i}` }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
  expect(
    await db
      .prepare("SELECT COUNT(*) AS n FROM invitation_delivery_intent")
      .first(),
  ).toEqual({ n: 10 });
  const first = results.find((r) => r.status === "fulfilled");
  if (first?.status !== "fulfilled") throw new Error("fixture");
  const row = await db
    .prepare("SELECT operation_id FROM workspace_invitation WHERE id=?")
    .bind(first.value.id)
    .first<{ operation_id: string }>();
  expect(
    await invites.create(owner, "team", {
      ...input,
      operationId: row!.operation_id,
    }),
  ).toEqual(first.value);
  await db.prepare("UPDATE invitation_budget SET window_start=0").run();
  expect(
    (await invites.create(owner, "team", { ...input, operationId: "later" }))
      .state,
  ).toBe("pending");
});
it("database failure rolls back invitation and intent together", async () => {
  await db.exec(
    "CREATE TRIGGER fail_delivery BEFORE INSERT ON invitation_delivery_intent BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;",
  );
  await expect(invites.create(owner, "team", input)).rejects.toMatchObject({
    code: "command_unknown",
  });
  expect(
    await db.prepare("SELECT COUNT(*) AS n FROM workspace_invitation").first(),
  ).toEqual({ n: 0 });
  expect(
    await db.prepare("SELECT COUNT(*) AS n FROM collaboration_guard").first(),
  ).toEqual({ n: 0 });
});
it.each([
  "wrong_email",
  "stale_generation",
  "revoked",
  "unknown",
  "other_account",
] as const)("recipient proof %s cannot create membership", async (kind) => {
  const invitation = await invites.create(owner, "team", input);
  const p = {
    ...recipient,
    verifiedEmails:
      kind === "wrong_email"
        ? ["another@example.invalid"]
        : recipient.verifiedEmails,
    generation: kind === "stale_generation" ? 2 : 1,
    accountId: kind === "other_account" ? "owner_account" : recipient.accountId,
  };
  if (kind === "revoked")
    await db
      .prepare("DELETE FROM session WHERE id=?")
      .bind(target.sessionId)
      .run();
  await expect(
    invites.accept(target, kind === "unknown" ? "unknown" : invitation.id, p),
  ).rejects.toMatchObject({ code: "denied" });
  expect(
    await db
      .prepare("SELECT COUNT(*) AS n FROM membership WHERE user_id='target'")
      .first(),
  ).toEqual({ n: 0 });
});
it("pending list contains no recipient addresses and cancel does not affect another workspace", async () => {
  const invitation = await invites.create(owner, "team", input);
  expect(JSON.stringify(await invites.list(owner, "team"))).not.toContain(
    input.email,
  );
  await expect(invites.list(target, "team")).rejects.toMatchObject({
    code: "denied",
  });
  await expect(
    invites.cancel(outsider, "other", invitation.id),
  ).rejects.toMatchObject({ code: "denied" });
  await expect(invites.cancel(owner, "team", "unknown")).rejects.toMatchObject({
    code: "denied",
  });
  expect((await invites.list(owner, "team"))[0]?.state).toBe("pending");
});

it("recipient email appears only in authorized owner management and never in acceptance DTO", async () => {
  const invitation = await invites.create(owner, "team", input);
  expect(invitation.recipientEmail).toBe(input.email);
  expect((await invites.list(owner, "team"))[0]?.recipientEmail).toBe(
    input.email,
  );
  await expect(invites.list(target, "team")).rejects.toMatchObject({
    code: "denied",
  });
  const accepted = await invites.accept(target, invitation.id, recipient);
  expect(accepted).toEqual({ status: "accepted", membershipActive: true });
});
