import type { AdmittedUser } from "@holon/contracts/dashboard";
import {
  applyD1Migrations,
  env,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { afterEach, expect, it } from "vitest";

import { createCredentialPersistence } from "../src/github-credentials.server.js";
const bindings = env as {
  IDENTITY_DB: D1Database;
  IDENTITY_MIGRATIONS: D1Migration[];
};
const db = bindings.IDENTITY_DB;
const actor: AdmittedUser = {
  id: "user",
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
        "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('user','Synthetic','synthetic@example.invalid',1,?,?)",
      )
      .bind(now, now),
    db
      .prepare(
        "INSERT INTO account(id,userId,providerId,accountId,accessToken,refreshToken,accessTokenExpiresAt,refreshTokenExpiresAt,createdAt,updatedAt) VALUES('account','user','github','123','cipher-access','cipher-refresh',?,?,?,?)",
      )
      .bind(now - 1000, now + 3600000, now, now),
    db
      .prepare(
        "INSERT INTO session(id,userId,token,createdAt,updatedAt,expiresAt) VALUES('session','user','synthetic',?,?,?)",
      )
      .bind(now, now, now + 3600000),
  ]);
  return createCredentialPersistence(db);
}
it("admits one refresh claim across independent workers and fences late results", async () => {
  const store = await setup();
  const row = await store.read(actor);
  const claims = await Promise.all([
    store.claim(actor, row),
    store.claim(actor, row),
  ]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const claim = claims.find(Boolean)!;
  await db
    .prepare(
      "UPDATE account SET accessToken='new-oauth-cipher' WHERE id='account'",
    )
    .run();
  expect(
    await store.complete(actor, claim, {
      accessToken: "old-refresh",
      refreshToken: "old-refresh-pair",
      accessExpiresAt: Date.now() + 10000,
      refreshExpiresAt: Date.now() + 20000,
    }),
  ).toBe(false);
  expect((await store.read(actor)).accessToken).toBe("new-oauth-cipher");
});
it("unknown outcome closes credentials until a new OAuth generation", async () => {
  const store = await setup();
  const claim = (await store.claim(actor, await store.read(actor)))!;
  await store.disconnect(actor, claim);
  expect((await store.read(actor)).state).toBe("reconnect_required");
  expect(await store.claim(actor, await store.read(actor))).toBeNull();
});
