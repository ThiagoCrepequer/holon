import { reset } from "cloudflare:test";
import { afterEach, beforeEach, expect, it } from "vitest";

import { createConnectionPersistence } from "../src/github-connections.server.js";
import { createGrantPersistence } from "../src/github-grants.server.js";
import {
  db,
  owner,
  target,
  outsider,
  seedCollaboration,
  proof,
} from "./support/collaboration-fixture.js";
const connections = createConnectionPersistence(db);
const grants = createGrantPersistence(db);
const key = {
  accountId: "owner_account",
  credentialGeneration: 1,
  installationId: 77,
  connectionGeneration: 1,
};
const githubProof = {
  accountId: "owner_account",
  credentialGeneration: 1,
  installationId: 77,
  accountOwnerId: 101,
};
beforeEach(seedCollaboration);
afterEach(async () => reset());
async function link() {
  return connections.mutate(
    owner,
    "team",
    await proof(owner),
    "link",
    githubProof,
  );
}
it("owner proof creates unique connection, consumes reauth and permits multiple installations", async () => {
  expect(await link()).toEqual({
    installationId: 77,
    state: "active",
    generation: 1,
  });
  expect(await connections.list(owner, "team")).toHaveLength(1);
  expect(
    await connections.mutate(
      owner,
      "team",
      await proof(owner, "team", 78, "link", "second"),
      "link",
      { ...githubProof, installationId: 78 },
    ),
  ).toMatchObject({ installationId: 78 });
  await expect(
    connections.mutate(
      outsider,
      "other",
      await proof(outsider, "other", 77, "link", "other"),
      "link",
      { ...githubProof, accountId: "outsider_account", accountOwnerId: 103 },
    ),
  ).rejects.toMatchObject({ code: "denied" });
  expect(await connections.list(outsider, "other")).toEqual([]);
});
it("two workspaces compete and the loser keeps its proof unconsumed", async () => {
  const a = await proof(owner);
  const b = await proof(outsider, "other", 77, "link", "other");
  const results = await Promise.allSettled([
    connections.mutate(owner, "team", a, "link", githubProof),
    connections.mutate(outsider, "other", b, "link", {
      ...githubProof,
      accountId: "outsider_account",
      accountOwnerId: 103,
    }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    await db.prepare("SELECT COUNT(*) AS n FROM github_connection").first(),
  ).toEqual({ n: 1 });
  expect(
    await db
      .prepare(
        "SELECT COUNT(*) AS n FROM reauth_intent WHERE consumed_at IS NOT NULL",
      )
      .first(),
  ).toEqual({ n: 1 });
});
it.each([
  "member",
  "missing",
  "expired",
  "unconfirmed",
  "wrong_session",
  "stale_generation",
  "wrong_installation",
] as const)("denies %s connection proof", async (kind) => {
  const input = await proof(owner);
  if (kind === "member")
    await db.prepare("UPDATE reauth_intent SET user_id='target'").run();
  if (kind === "expired")
    await db.prepare("UPDATE reauth_intent SET expires_at=0").run();
  if (kind === "unconfirmed")
    await db.prepare("UPDATE reauth_intent SET confirmed_at=NULL").run();
  if (kind === "wrong_session")
    await db.prepare("UPDATE reauth_intent SET proof_session_id='other'").run();
  await expect(
    connections.mutate(
      kind === "member" ? target : owner,
      "team",
      {
        ...input,
        reauthIntentId: kind === "missing" ? "missing" : input.reauthIntentId,
      },
      "link",
      {
        ...githubProof,
        credentialGeneration: kind === "stale_generation" ? 2 : 1,
        installationId: kind === "wrong_installation" ? 78 : 77,
      },
    ),
  ).rejects.toMatchObject({ code: "denied" });
  expect(
    await db.prepare("SELECT COUNT(*) AS n FROM github_connection").first(),
  ).toEqual({ n: 0 });
});
it("connection reauth supports personal owner but not a team member or revoked session", async () => {
  const p = await connections.createReauth(owner, "personal", 77, "link");
  expect(p.reauthIntentId).toContain("reauth_");
  await expect(
    connections.createReauth(target, "team", 77, "link"),
  ).rejects.toMatchObject({ code: "denied" });
  await db
    .prepare("DELETE FROM session WHERE id=?")
    .bind(owner.sessionId)
    .run();
  await expect(
    connections.createReauth(owner, "team", 77, "link"),
  ).rejects.toMatchObject({ code: "denied" });
});
it("grants cache empty and positive results for at most 60s and unlink fences both", async () => {
  await link();
  expect(await grants.read(owner, "team", key)).toBeNull();
  expect(await grants.write(owner, "team", key, [], Date.now())).toBe(true);
  expect((await grants.read(owner, "team", key))?.repositoryIds).toEqual([]);
  expect(await grants.write(owner, "team", key, [91, 92], Date.now())).toBe(
    true,
  );
  expect((await grants.read(owner, "team", key))?.repositoryIds).toEqual([
    91, 92,
  ]);
  await db
    .prepare(
      "UPDATE github_grant_cache SET expires_at=CAST(unixepoch('subsec')*1000 AS INTEGER)",
    )
    .run();
  expect(await grants.read(owner, "team", key)).toBeNull();
  expect(await grants.write(owner, "team", key, [91], Date.now() - 61000)).toBe(
    false,
  );
  await connections.mutate(
    owner,
    "team",
    await proof(owner, "team", 77, "unlink", "unlink"),
    "unlink",
    githubProof,
  );
  await expect(
    grants.assertCurrent(owner, "team", key.accountId, 1, [
      { installationId: 77, generation: 1, grantExpiresAt: Date.now() + 60000 },
    ]),
  ).rejects.toMatchObject({ code: "denied" });
});
it.each([
  "suspended",
  "revoked",
  "repositories_changed",
  "user_revoked",
] as const)("event %s invalidates cached grants", async (action) => {
  await link();
  await grants.write(owner, "team", key, [91], Date.now());
  await connections.applyEvent(
    action === "user_revoked"
      ? { deliveryId: "delivery", action, githubAccountId: "101" }
      : { deliveryId: "delivery", installationId: 77, action },
  );
  expect(await grants.read(owner, "team", key)).toBeNull();
  if (action === "user_revoked")
    await expect(
      grants.assertCurrent(owner, "team", key.accountId, 1, []),
    ).rejects.toMatchObject({ code: "reconnect_required" });
});
it("removed membership denies next scope and corrupt cache never becomes permission", async () => {
  await link();
  await grants.write(owner, "team", key, [91], Date.now());
  await db.prepare("UPDATE github_grant_cache SET repository_ids='{}'").run();
  await expect(grants.read(owner, "team", key)).rejects.toMatchObject({
    code: "unavailable",
  });
  await db.prepare("UPDATE github_grant_cache SET repository_ids='[0]'").run();
  await expect(grants.read(owner, "team", key)).rejects.toMatchObject({
    code: "unavailable",
  });
  await expect(grants.read(target, "team", key)).rejects.toMatchObject({
    code: "denied",
  });
});

it("duplicate access deliveries cannot revoke a later reconnected generation", async () => {
  await link();
  await connections.applyEvent({
    deliveryId: "once",
    action: "user_revoked",
    githubAccountId: "101",
  });
  await db
    .prepare(
      "UPDATE account SET accessToken='new-oauth-cipher' WHERE id='owner_account'",
    )
    .run();
  const before = await db
    .prepare(
      "SELECT generation,state FROM github_credential_state WHERE account_id='owner_account'",
    )
    .first();
  await connections.applyEvent({
    deliveryId: "once",
    action: "user_revoked",
    githubAccountId: "101",
  });
  expect(
    await db
      .prepare(
        "SELECT generation,state FROM github_credential_state WHERE account_id='owner_account'",
      )
      .first(),
  ).toEqual(before);
});
