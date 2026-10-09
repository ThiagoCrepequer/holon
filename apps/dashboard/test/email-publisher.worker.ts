import { createInvitationPersistence } from "@holon/db/identity/server";
import {
  reset,
  env,
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { createExecutionContext } from "cloudflare:test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

import { EmailDeliveryAuthority } from "../workers/email-delivery-authority.js";
import { publishDueEmail } from "../workers/email-publisher.js";
import { seedCollaboration } from "./support/collaboration-cases.js";

const bindings = env as unknown as {
  IDENTITY_DB: D1Database;
  IDENTITY_MIGRATIONS: D1Migration[];
};
const db = bindings.IDENTITY_DB;
beforeEach(async () => {
  await applyD1Migrations(db, bindings.IDENTITY_MIGRATIONS);
  await seedCollaboration(db);
});
afterEach(async () => reset());
async function seedJob() {
  // The fixture owner session is already admitted by the same production guards.
  const actor = {
    id: "actor",
    name: "Synthetic",
    sessionId: "session",
    githubAccountId: "101",
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  return createInvitationPersistence(db).create(actor, "team", {
    operationId: "op",
    email: "target@example.invalid",
    locale: "en",
  });
}
it("cron publisher recovers lost publication records and Queue outage without spending effect attempts", async () => {
  const i = await seedJob();
  const wake = vi.fn(async () => ({ status: "unavailable" as const }));
  await publishDueEmail(db, { wake });
  expect(wake).toHaveBeenCalledWith({ operationId: i.id });
  expect(
    await db
      .prepare("SELECT attempts,state FROM invitation_delivery_intent")
      .first(),
  ).toEqual({ attempts: 0, state: "pending" });
  await db
    .prepare("UPDATE invitation_delivery_intent SET next_action_at=0")
    .run();
  wake.mockImplementation(async () => {
    throw new Error("synthetic Queue outage");
  });
  await publishDueEmail(db, { wake });
  await db
    .prepare("UPDATE invitation_delivery_intent SET next_action_at=0")
    .run();
  const accepted = vi.fn(async () => ({ status: "accepted" as const }));
  await publishDueEmail(db, { wake: accepted });
  expect(
    await db
      .prepare(
        "SELECT publication_id,state,attempts FROM invitation_delivery_intent",
      )
      .first(),
  ).toEqual({ publication_id: null, state: "pending", attempts: 0 });
  await publishDueEmail(db, { wake: accepted });
  expect(accepted).toHaveBeenCalledTimes(1);
  // Simulates all Queue/DLQ references lost beyond retention.
  await db
    .prepare("UPDATE invitation_delivery_intent SET next_action_at=0")
    .run();
  await publishDueEmail(db, { wake: accepted });
  expect(accepted).toHaveBeenCalledTimes(2);
});
it("D1 failure precedes publish; terminal jobs never wake and entrypoint denies HTTP", async () => {
  const wake = vi.fn();
  await expect(
    publishDueEmail(
      {
        prepare: () => {
          throw new Error("synthetic D1 outage");
        },
      } as unknown as D1Database,
      { wake },
    ),
  ).rejects.toThrow();
  expect(wake).not.toHaveBeenCalled();
  const i = await seedJob();
  await db
    .prepare("UPDATE workspace_invitation SET state='canceled' WHERE id=?")
    .bind(i.id)
    .run();
  await publishDueEmail(db, { wake });
  expect(wake).not.toHaveBeenCalled();
  const authority = new EmailDeliveryAuthority(createExecutionContext(), {
    IDENTITY_DB: db,
  });
  expect(authority.fetch().status).toBe(404);
  expect(await authority.claim({ jobId: i.id })).toBeNull();
  await expect(authority.start({})).rejects.toThrow();
  await expect(authority.record({})).rejects.toThrow();
});
