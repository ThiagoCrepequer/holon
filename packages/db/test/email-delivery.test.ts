import { reset } from "cloudflare:test";
import { afterEach, beforeEach, expect, it } from "vitest";

import { createEmailDeliveryPersistence } from "../src/email-delivery.server.js";
import { createInvitationPersistence } from "../src/invitations.server.js";
import {
  db,
  owner,
  seedCollaboration,
} from "./support/collaboration-fixture.js";

const delivery = createEmailDeliveryPersistence(db);
async function invitation() {
  return createInvitationPersistence(db).create(owner, "team", {
    operationId: "op",
    email: "target@example.invalid",
    locale: "en",
  });
}
async function lapse() {
  await db
    .prepare(
      "UPDATE invitation_delivery_intent SET lease_until=1,retry_at=0,next_action_at=0",
    )
    .run();
  await db.prepare("UPDATE email_delivery_attempt SET lease_until=1").run();
}
function attempt(
  claim: NonNullable<Awaited<ReturnType<typeof delivery.claim>>>,
) {
  return {
    jobId: claim.jobId,
    attemptId: claim.attemptId,
    generation: claim.generation,
  };
}
beforeEach(seedCollaboration);
afterEach(async () => reset());
it("two consumers reserve only one durable effect attempt", async () => {
  const created = await createInvitationPersistence(db).create(owner, "team", {
    operationId: "op",
    email: "target@example.invalid",
    locale: "en",
  });
  const claims = await Promise.all([
    delivery.claim({ jobId: created.id }),
    delivery.claim({ jobId: created.id }),
  ]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  expect(
    await db.prepare("SELECT attempts FROM invitation_delivery_intent").first(),
  ).toEqual({ attempts: 1 });
});
it("forged, canceled, accepted and expired jobs cannot disclose recipients", async () => {
  expect(await delivery.claim({ jobId: "forged" })).toBeNull();
  await expect(
    delivery.claim({ jobId: "forged", recipient: "private" }),
  ).rejects.toThrow();
  await expect(delivery.start({})).rejects.toThrow();
  await expect(delivery.record({})).rejects.toThrow();
  const i = await invitation();
  const c = (await delivery.claim({ jobId: i.id }))!;
  expect(await delivery.record({ ...attempt(c), outcome: "accepted" })).toEqual(
    { recorded: false },
  );
  expect(
    await delivery.start({ ...attempt(c), attemptId: crypto.randomUUID() }),
  ).toBeNull();
  await createInvitationPersistence(db).cancel(owner, "team", i.id);
  expect(await delivery.start(attempt(c))).toBeNull();
  expect(await delivery.claim({ jobId: i.id })).toBeNull();
  expect(await delivery.due()).toEqual([]);
});
it("context is minimal, start is single use and old success does not rewrite the new lease", async () => {
  const i = await invitation();
  const old = (await delivery.claim({ jobId: i.id }))!;
  expect(await delivery.start(attempt(old))).toMatchObject({
    jobId: i.id,
    recipient: "target@example.invalid",
    workspaceName: "Synthetic",
  });
  expect(await delivery.start(attempt(old))).toBeNull();
  await lapse();
  await delivery.due();
  await db.prepare("UPDATE invitation_delivery_intent SET retry_at=0").run();
  const next = (await delivery.claim({ jobId: i.id }))!;
  const lease = await db
    .prepare("SELECT generation,lease_until FROM invitation_delivery_intent")
    .first();
  expect(
    await delivery.record({ ...attempt(old), outcome: "accepted" }),
  ).toEqual({ recorded: true });
  expect(
    await db
      .prepare("SELECT generation,lease_until FROM invitation_delivery_intent")
      .first(),
  ).toEqual(lease);
  expect(await delivery.start(attempt(next))).toBeNull();
  expect(await delivery.claim({ jobId: i.id })).toBeNull();
  expect(
    (await createInvitationPersistence(db).list(owner, "team"))[0]?.delivery,
  ).toBe("provider_accepted");
  expect(
    await delivery.record({ ...attempt(old), outcome: "transient" }),
  ).toEqual({ recorded: false });
});
it("a duplicate Queue reference cannot bypass crash recovery backoff", async () => {
  const i = await invitation();
  const c = (await delivery.claim({ jobId: i.id }))!;
  await delivery.start(attempt(c));
  await lapse();
  expect(await delivery.claim({ jobId: i.id })).toBeNull();
});
it.each(["transient", "unknown", "permanent"] as const)(
  "persists %s with backoff, idempotence and bounded retries",
  async (outcome) => {
    const i = await invitation();
    const c = (await delivery.claim({ jobId: i.id }))!;
    await delivery.start(attempt(c));
    expect(await delivery.record({ ...attempt(c), outcome })).toEqual({
      recorded: true,
    });
    const before = await db
      .prepare("SELECT * FROM invitation_delivery_intent")
      .first();
    expect(await delivery.record({ ...attempt(c), outcome })).toEqual({
      recorded: true,
    });
    expect(
      await db.prepare("SELECT * FROM invitation_delivery_intent").first(),
    ).toEqual(before);
    expect(await delivery.claim({ jobId: i.id })).toBeNull();
    expect(
      (await createInvitationPersistence(db).list(owner, "team"))[0]?.delivery,
    ).toBe(
      outcome === "permanent"
        ? "failed"
        : outcome === "unknown"
          ? "result_unknown"
          : "intent_recorded",
    );
    if (outcome === "unknown") {
      expect(
        await delivery.record({ ...attempt(c), outcome: "accepted" }),
      ).toEqual({ recorded: true });
      expect(await delivery.due()).toEqual([]);
    }
  },
);
it("crash after claim consumes budget; long lost-Queue outage recovers without a request", async () => {
  const i = await invitation();
  expect(await delivery.due()).toEqual([i.id]);
  const pub = await delivery.reservePublication(i.id);
  expect(pub).toBeTruthy();
  expect(await delivery.reservePublication(i.id)).toBeNull();
  // Crash before/after Queue send: the transport reference may disappear.
  await db
    .prepare("UPDATE invitation_delivery_intent SET next_action_at=0")
    .run();
  expect(await delivery.due()).toEqual([i.id]);
  const newer = (await delivery.reservePublication(i.id))!;
  await delivery.published(i.id, pub!);
  expect(
    await db
      .prepare("SELECT publication_id FROM invitation_delivery_intent")
      .first(),
  ).toEqual({ publication_id: newer });
  await delivery.published(i.id, newer);
  expect(await delivery.due()).toEqual([]);
  await db
    .prepare("UPDATE invitation_delivery_intent SET next_action_at=0")
    .run();
  expect(await delivery.due()).toEqual([i.id]);
  for (let n = 1; n <= 5; n++) {
    const c = await delivery.claim({ jobId: i.id });
    expect(c).not.toBeNull();
    expect(
      await db
        .prepare("SELECT attempts FROM invitation_delivery_intent")
        .first(),
    ).toEqual({ attempts: n });
    await lapse();
    await delivery.due();
    await db
      .prepare(
        "UPDATE invitation_delivery_intent SET retry_at=0,next_action_at=0",
      )
      .run();
  }
  expect(await delivery.claim({ jobId: i.id })).toBeNull();
  expect(await delivery.due()).toEqual([]);
  expect(
    await db.prepare("SELECT COUNT(*) n FROM workspace_invitation").first(),
  ).toEqual({ n: 1 });
  expect(
    await db
      .prepare("SELECT COUNT(*) n FROM membership WHERE user_id='target'")
      .first(),
  ).toEqual({ n: 0 });
});
it("expiry and deadline are independent of retention; metrics expose aggregates only", async () => {
  const i = await invitation();
  expect(await delivery.metrics()).toMatchObject({ pending: 1, due: 1 });
  await db.prepare("UPDATE workspace_invitation SET expires_at=0").run();
  expect(await delivery.claim({ jobId: i.id })).toBeNull();
  expect(await delivery.due()).toEqual([]);
  expect(
    await db.prepare("SELECT state FROM invitation_delivery_intent").first(),
  ).toEqual({ state: "canceled" });
});
it("budget/deadline terminalize without reviving, and cancellation preserves late acceptance history", async () => {
  const i = await invitation();
  const c = (await delivery.claim({ jobId: i.id }))!;
  await delivery.start(attempt(c));
  await createInvitationPersistence(db).cancel(owner, "team", i.id);
  await delivery.record({ ...attempt(c), outcome: "accepted" });
  expect(
    await db
      .prepare("SELECT state,last_outcome FROM invitation_delivery_intent")
      .first(),
  ).toEqual({ state: "canceled", last_outcome: "accepted" });
  expect(await delivery.start(attempt(c))).toBeNull();
  expect(await delivery.due()).toEqual([]);
});
it("deadline and stale generation cannot authorize an effect or resurrect a job", async () => {
  const i = await invitation();
  const c = (await delivery.claim({ jobId: i.id }))!;
  expect(
    await delivery.start({ ...attempt(c), generation: c.generation + 1 }),
  ).toBeNull();
  expect(
    await delivery.record({
      ...attempt(c),
      generation: c.generation + 1,
      outcome: "accepted",
    }),
  ).toEqual({ recorded: false });
  await db.prepare("UPDATE invitation_delivery_intent SET deadline=0").run();
  expect(await delivery.start(attempt(c))).toBeNull();
  expect(await delivery.due()).toEqual([]);
  expect(
    await db.prepare("SELECT state FROM invitation_delivery_intent").first(),
  ).toEqual({ state: "failed" });
  expect(await delivery.reservePublication(i.id)).toBeNull();
});
