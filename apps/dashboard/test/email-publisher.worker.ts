import { createInvitationPersistence } from "@holon/db/identity/server";
import { createProjectionPersistence } from "@holon/db/projection/server";
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
import { ReviewProjectionWriter } from "../workers/review-projection-writer.js";
import { seedCollaboration } from "./support/collaboration-cases.js";

const bindings = env as unknown as {
  IDENTITY_DB: D1Database;
  IDENTITY_MIGRATIONS: D1Migration[];
  PROJECTION_DB: D1Database;
  PROJECTION_MIGRATIONS: D1Migration[];
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
    DASHBOARD_RECOVERY_MODE: "active",
  });
  expect(authority.fetch().status).toBe(404);
  expect(await authority.claim({ jobId: i.id })).toBeNull();
  await expect(authority.start({})).rejects.toThrow();
  await expect(authority.record({})).rejects.toThrow();
});

it("identity recovery blocks old Queue claims/start while preserving late causal outcome and the global budget", async () => {
  const startedAt = Date.now();
  const invitation = await seedJob();
  await applyD1Migrations(
    bindings.PROJECTION_DB,
    bindings.PROJECTION_MIGRATIONS,
  );
  const projectionEnv = {
    PROJECTION_DB: bindings.PROJECTION_DB,
    DASHBOARD_RECOVERY_MODE: "active",
  };
  const writer = new ReviewProjectionWriter(
    createExecutionContext(),
    projectionEnv,
  );
  const snapshot = {
    installationId: 101,
    repositoryId: 201,
    pullRequestNumber: 1,
    title: "Synthetic restore",
    author: "synthetic",
    pullRequestState: "open",
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    runId: null,
    state: "awaiting_review",
    snapshotRevision: 100,
    activityAt: "2026-10-09T00:00:00.000Z",
    observedAt: "2026-10-09T00:00:00.000Z",
  };
  const captured = { generation: 1, snapshot };
  expect(await writer.write(captured)).toBe("applied");
  const active = new EmailDeliveryAuthority(createExecutionContext(), {
    IDENTITY_DB: db,
    DASHBOARD_RECOVERY_MODE: "active",
  });
  const claim = await active.claim({ jobId: invitation.id });
  expect(claim).not.toBeNull();
  const attempt = {
    jobId: claim!.jobId,
    attemptId: claim!.attemptId,
    generation: claim!.generation,
  };
  expect(await active.start(attempt)).not.toBeNull();
  const before = await db
    .prepare(
      "SELECT attempts,max_attempts,deadline,generation FROM invitation_delivery_intent",
    )
    .first();
  // Restored identity can contain sessions and jobs; the independent deployment hold remains closed.
  const closed = new EmailDeliveryAuthority(createExecutionContext(), {
    IDENTITY_DB: db,
    DASHBOARD_RECOVERY_MODE: "closed",
  });
  const heldWriter = new ReviewProjectionWriter(createExecutionContext(), {
    ...projectionEnv,
    DASHBOARD_RECOVERY_MODE: "closed",
  });
  expect(() => heldWriter.write(captured)).toThrow("projection_paused");
  expect(
    await heldWriter.beginRecovery({
      installationId: 101,
      repositoryId: 201,
      expectedGeneration: 1,
    }),
  ).toBe(2);
  const rebuilding = new ReviewProjectionWriter(createExecutionContext(), {
    ...projectionEnv,
    DASHBOARD_RECOVERY_MODE: "rebuilding",
  });
  expect(
    await rebuilding.write({
      generation: 2,
      snapshot: { ...snapshot, snapshotRevision: 60 },
    }),
  ).toBe("applied");
  expect(await writer.write(captured)).toBe("fenced");
  await rebuilding.activateRecovery({
    installationId: 101,
    repositoryId: 201,
    expectedGeneration: 2,
  });
  const list = await createProjectionPersistence(bindings.PROJECTION_DB).list({
    workspaceId: "team",
    installationId: 101,
    repositoryId: 201,
    status: null,
    search: "",
    cursor: null,
    limit: 50,
  });
  expect(list.items.map((item) => item.snapshotRevision)).toEqual([60]);
  expect(await closed.claim({ jobId: invitation.id })).toBeNull();
  expect(await closed.start(attempt)).toBeNull();
  // A hold cannot cancel an effect already sent. Its causal acceptance must still be recorded.
  await closed.record({ ...attempt, outcome: "accepted" });
  await db.batch([
    db.prepare(
      "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('recovery_owner','Synthetic owner','owner@example.invalid',1,0,0)",
    ),
    db.prepare(
      "INSERT INTO membership VALUES('team','recovery_owner','owner',0,0)",
    ),
    db.prepare("DELETE FROM session"),
    db.prepare(
      "DELETE FROM membership WHERE workspace_id='team' AND user_id='actor'",
    ),
  ]);
  expect(
    await db.prepare("SELECT count(*) AS total FROM session").first(),
  ).toEqual({ total: 0 });
  expect(
    await db
      .prepare("SELECT count(*) AS total FROM membership WHERE user_id='actor'")
      .first(),
  ).toEqual({ total: 0 });
  // Reopen only after trusted authority reconciliation. An old queue message never spends another attempt.
  expect(await active.claim({ jobId: invitation.id })).toBeNull();
  expect(
    await db
      .prepare(
        "SELECT attempts,max_attempts,deadline,generation FROM invitation_delivery_intent",
      )
      .first(),
  ).toEqual(before);
  const wake = vi.fn();
  await publishDueEmail(db, { wake });
  expect(wake).not.toHaveBeenCalled();
  console.info(
    JSON.stringify({
      event: "recovery_drill",
      code: 1,
      duration_ms: Date.now() - startedAt,
    }),
  );
});

it("numeric health signals trigger and recover without invitation payload or provider exceptions", async () => {
  await seedJob();
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    await db
      .prepare(
        "UPDATE invitation_delivery_intent SET next_action_at=0,last_outcome='unknown'",
      )
      .run();
    await publishDueEmail(db, {
      wake: async () => ({ status: "unavailable" }),
    });
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ event: "email_health", code: 2 }),
    );
    await db
      .prepare(
        "UPDATE invitation_delivery_intent SET next_action_at=?,last_outcome='unknown'",
      )
      .bind(Date.now() + 60000)
      .run();
    await publishDueEmail(db, { wake: vi.fn() });
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ event: "email_health", code: 1 }),
    );
    await db
      .prepare("UPDATE invitation_delivery_intent SET last_outcome=NULL")
      .run();
    await publishDueEmail(db, { wake: vi.fn() });
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ event: "email_health", code: 0 }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      /target@|token|authorization|body|prompt|exception/u,
    );
  } finally {
    log.mockRestore();
  }
});
