import type { AdmittedUser } from "@holon/contracts/dashboard";
import { sessionDeviceListDtoSchema } from "@holon/contracts/dashboard";
import {
  applyD1Migrations,
  env,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { afterEach, expect, it } from "vitest";

import {
  createSessionPersistence,
  parseDeviceBrowserLabel,
} from "../src/identity.server.js";

const bindings = env as {
  IDENTITY_DB: D1Database;
  IDENTITY_MIGRATIONS: D1Migration[];
};
const database = bindings.IDENTITY_DB;
it("recognizes mobile browser labels while unknown agents remain coarse", () => {
  for (const [agent, label] of [
    ["Mozilla/5.0 Edg/130.0 Chrome/130.0 Safari/537.36", "edge"],
    ["Mozilla/5.0 CriOS/130.0 Mobile Safari/604.1", "chrome"],
    ["Mozilla/5.0 FxiOS/130.0 Mobile Safari/604.1", "firefox"],
    ["Unknown synthetic agent", "other"],
    [undefined, "other"],
    ["", "other"],
  ] as const)
    expect(parseDeviceBrowserLabel(agent)).toBe(label);
});
afterEach(async () => {
  await reset();
});
async function fixture() {
  await applyD1Migrations(database, bindings.IDENTITY_MIGRATIONS);
  const now = Date.now();
  for (const id of ["session_owner", "session_other"]) {
    await database
      .prepare(
        "INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,?,?)",
      )
      .bind(id, id, `${id}@example.invalid`, now, now)
      .run();
  }
  await database
    .prepare(
      "INSERT INTO account (id,accountId,providerId,userId,createdAt,updatedAt) VALUES ('session_account','subject_owner','github','session_owner',?,?)",
    )
    .bind(now, now)
    .run();
  const rows = [
    {
      id: "current",
      owner: "session_owner",
      agent: "Synthetic Chrome/1 Safari/1",
    },
    { id: "edge", owner: "session_owner", agent: "Synthetic Edge/1" },
    { id: "firefox", owner: "session_owner", agent: "Synthetic Firefox/1" },
    { id: "safari", owner: "session_owner", agent: "Synthetic Safari/1" },
    { id: "unknown", owner: "session_owner", agent: null },
    { id: "expired", owner: "session_owner", agent: "Synthetic Other" },
    { id: "foreign", owner: "session_other", agent: "Synthetic Firefox/1" },
  ];
  for (const row of rows) {
    await database
      .prepare(
        "INSERT INTO session (id,token,userId,expiresAt,createdAt,updatedAt,userAgent,ipAddress) VALUES (?,?,?,?,?,?,?,?)",
      )
      .bind(
        row.id,
        `synthetic-token-${row.id}`,
        row.owner,
        row.id === "expired" ? now - 1000 : now + 120_000,
        now - 1000,
        now - 1000,
        row.agent,
        "192.0.2.10",
      )
      .run();
  }
  const actor: AdmittedUser = {
    id: "session_owner",
    name: "Synthetic owner",
    githubAccountId: "subject_owner",
    sessionId: "current",
    expiresAt: new Date(now + 120_000).toISOString(),
  };
  return { store: createSessionPersistence(database), actor, now };
}
async function count(sql: string) {
  return database.prepare(sql).first<number>("count");
}

it("lists only live sessions of the requested User with coarse labels and no credentials", async () => {
  const { store, actor, now } = await fixture();
  const page = await store.listSessions(actor.id, actor.sessionId, now);
  sessionDeviceListDtoSchema.parse(page);
  const sessions = page.sessions;
  expect(page.currentSessionId).toBe(actor.sessionId);
  expect(page.nextCursor).toBeNull();
  expect(sessions.map((s) => s.id).toSorted()).toEqual([
    "current",
    "edge",
    "firefox",
    "safari",
    "unknown",
  ]);
  expect(sessions.map((s) => s.label).toSorted()).toEqual([
    "chrome",
    "edge",
    "firefox",
    "other",
    "safari",
  ]);
  expect(sessions.filter((s) => s.isCurrent).map((s) => s.id)).toEqual([
    "current",
  ]);
  const serialized = JSON.stringify(sessions);
  expect(serialized).not.toContain("synthetic-token");
  expect(serialized).not.toContain("192.0.2.10");
  expect(serialized).not.toContain("Synthetic Chrome");
});

it("bounds every device page and traverses tied timestamps without skipping own sessions", async () => {
  const { store, actor, now } = await fixture();
  await database
    .prepare(
      `WITH RECURSIVE devices(n) AS (
         SELECT 1 UNION ALL SELECT n+1 FROM devices WHERE n < 205
       )
       INSERT INTO session (id,token,userId,expiresAt,createdAt,updatedAt)
       SELECT 'page_' || printf('%03d', n), 'synthetic_page_' || n, ?, ?, ?, ?
       FROM devices`,
    )
    .bind(actor.id, now + 120_000, now, now)
    .run();
  const seen: string[] = [];
  let cursor: string | undefined;
  const sizes: number[] = [];
  do {
    const page = await store.listSessions(
      actor.id,
      actor.sessionId,
      now,
      cursor,
    );
    sessionDeviceListDtoSchema.parse(page);
    expect(page.currentSessionId).toBe(actor.sessionId);
    sizes.push(page.sessions.length);
    seen.push(...page.sessions.map((session) => session.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(sizes).toEqual([100, 100, 10]);
  expect(seen).toEqual([
    ...Array.from(
      { length: 205 },
      (_, index) => `page_${String(205 - index).padStart(3, "0")}`,
    ),
    "unknown",
    "safari",
    "firefox",
    "edge",
    "current",
  ]);
  expect(new Set(seen).size).toBe(210);
  expect(
    await store.listSessions(actor.id, actor.sessionId, now, "current"),
  ).toEqual({
    sessions: [],
    currentSessionId: actor.sessionId,
    nextCursor: null,
  });
});

it("rejects foreign, missing and expired device cursors instead of restarting pagination", async () => {
  const { store, actor, now } = await fixture();
  for (const cursor of ["foreign", "missing", "expired"]) {
    await expect(
      store.listSessions(actor.id, actor.sessionId, now, cursor),
    ).rejects.toMatchObject({
      code: "operation_conflict",
    });
  }
  await store.revokeSession(actor, "edge", now);
  await expect(
    store.listSessions(actor.id, actor.sessionId, now, "edge"),
  ).rejects.toMatchObject({
    code: "operation_conflict",
  });
  // Empty pages still require live authority in the same SQL snapshot.
  await store.revokeSession(actor, actor.sessionId, now);
  await expect(
    store.listSessions(actor.id, actor.sessionId, now, "safari"),
  ).rejects.toMatchObject({
    code: "user_not_admitted",
  });
});

it("revokes only an own target, makes replay safe and cleans each transient guard", async () => {
  const { store, actor, now } = await fixture();
  expect(await store.revokeSession(actor, "foreign", now)).toBe(false);
  expect(await store.revokeSession(actor, "edge", now)).toBe(true);
  expect(await store.revokeSession(actor, "edge", now)).toBe(false);
  expect(await store.readSession("edge", actor.id)).toBeNull();
  expect(await store.readSession("current", actor.id)).not.toBeNull();
  expect(await store.readSession("foreign", "session_other")).not.toBeNull();
  expect(
    await count("SELECT COUNT(*) AS count FROM tenancy_mutation_guard"),
  ).toBe(0);
  expect(await store.revokeSession(actor, "current", now)).toBe(true);
  expect(await store.readSession("current", actor.id)).toBeNull();
});

it("global revocation removes all own rows while preserving another User and cleaning the guard", async () => {
  const { store, actor, now } = await fixture();
  expect(await store.revokeAllSessions(actor, now)).toBe(6);
  expect(
    await count(
      "SELECT COUNT(*) AS count FROM session WHERE userId='session_owner'",
    ),
  ).toBe(0);
  expect(await store.readSession("foreign")).not.toBeNull();
  expect(
    await count("SELECT COUNT(*) AS count FROM tenancy_mutation_guard"),
  ).toBe(0);
  await expect(store.revokeAllSessions(actor, now)).rejects.toMatchObject({
    code: "user_not_admitted",
  });
});

for (const kind of ["subject", "session", "user"] as const) {
  it(`a mismatched ${kind} cannot revoke a target or leave a transient admission`, async () => {
    const { store, actor, now } = await fixture();
    const altered = {
      ...actor,
      ...(kind === "subject"
        ? { githubAccountId: "wrong_subject" }
        : kind === "session"
          ? { sessionId: "foreign" }
          : { id: "session_other" }),
    };
    await expect(
      store.revokeSession(altered, "edge", now),
    ).rejects.toMatchObject({ code: "user_not_admitted" });
    await expect(store.revokeAllSessions(altered, now)).rejects.toMatchObject({
      code: "user_not_admitted",
    });
    expect(await store.readSession("edge", actor.id)).not.toBeNull();
    expect(await count("SELECT COUNT(*) AS count FROM session")).toBe(7);
    expect(
      await count("SELECT COUNT(*) AS count FROM tenancy_mutation_guard"),
    ).toBe(0);
  });
}

it("renewal persists a later expiry, preserves newer expiry and denies a foreign or expired row", async () => {
  const { store, actor, now } = await fixture();
  const later = now + 7 * 86_400_000;
  expect(
    await store.renewSession("current", actor.id, now, later, now),
  ).toEqual({ status: "renewed" });
  expect(await store.readSession("current", actor.id)).toEqual({
    expiresAt: later,
    updatedAt: now,
  });
  expect(
    await store.renewSession(
      "current",
      actor.id,
      now,
      later - 1000,
      now - 1000,
    ),
  ).toEqual({
    status: "newer_exists",
    current: { expiresAt: later, updatedAt: now },
  });
  expect(
    await store.renewSession("foreign", actor.id, now, later, now),
  ).toEqual({ status: "denied" });
  expect(
    await store.renewSession("expired", actor.id, now, later, now),
  ).toEqual({ status: "denied" });
  expect(
    await database
      .prepare("SELECT expiresAt FROM session WHERE id='expired'")
      .first("expiresAt"),
  ).toBe(now - 1000);
});

it("expiry cleanup deletes only a still-expired row and cannot remove a later renewal", async () => {
  const { store, actor, now } = await fixture();
  expect(await store.deleteExpiredSession("current", now)).toBe(false);
  expect(await store.deleteExpiredSession("expired", now)).toBe(true);
  expect(await store.deleteExpiredSession("expired", now)).toBe(false);
  expect(await store.readSession("expired")).toBeNull();
  expect(await store.readSession("current", actor.id)).not.toBeNull();
});

it("active-session checks require the exact User and both request and SQLite clocks", async () => {
  const { store, actor, now } = await fixture();
  expect(await store.isSessionActive("current", actor.id, now)).toBe(true);
  expect(await store.isSessionActive("current", "session_other", now)).toBe(
    false,
  );
  expect(await store.isSessionActive("missing", actor.id, now)).toBe(false);
  expect(await store.isSessionActive("expired", actor.id, now - 2000)).toBe(
    false,
  );
  expect(await store.isSessionActive("current", actor.id, now + 120_000)).toBe(
    false,
  );
});

it("renewal cannot revive a SQLite-expired row when the request clock is behind", async () => {
  const { store, actor, now } = await fixture();
  const result = await store.renewSession(
    "expired",
    actor.id,
    now - 2000,
    now + 120_000,
    now - 2000,
  );
  expect(result).toEqual({ status: "denied" });
  expect(
    await database
      .prepare("SELECT expiresAt FROM session WHERE id='expired'")
      .first("expiresAt"),
  ).toBe(now - 1000);
});
