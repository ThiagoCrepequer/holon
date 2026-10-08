import { symmetricDecrypt } from "better-auth/crypto";
import { env, reset, type D1Migration } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";

import { credentialKeyConfig } from "../src/credential-key.server.js";
import {
  beginOAuth,
  completeOAuth,
  fakeGitHub,
  setupAuthService,
  testOrigin,
  testSecret,
} from "./support.js";
const bindings = env as { AUTH_DB: D1Database; AUTH_MIGRATIONS: D1Migration[] };
afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});
it("native OAuth writes versioned encrypted tokens and reconnection binds the same stable subject", async () => {
  const ring = [
    { version: 2, value: "synthetic-rotated-key-with-at-least-32-chars" },
  ];
  const auth = await setupAuthService({ secretVersions: ring });
  const provider = fakeGitHub();
  const flow = await beginOAuth(auth);
  provider.authorize(
    "initial",
    { id: 7001, email: "native@example.invalid", verified: true },
    flow.authorizationURL,
  );
  await completeOAuth(auth, flow, "initial");
  const account = await bindings.AUTH_DB.prepare(
    "SELECT id,accessToken,refreshToken FROM account WHERE providerId='github'",
  ).first<{ id: string; accessToken: string; refreshToken: string }>();
  expect(account?.accessToken.startsWith("$ba$2$")).toBe(true);
  expect(
    await symmetricDecrypt({
      key: credentialKeyConfig(testSecret, ring).cryptoKey,
      data: account!.accessToken,
    }),
  ).toContain("synthetic");
  const before = await bindings.AUTH_DB.prepare(
    "SELECT generation FROM github_credential_state WHERE account_id=?",
  )
    .bind(account!.id)
    .first();
  const wrong = await beginOAuth(auth, flow.jar);
  provider.authorize(
    "wrong",
    { id: 7002, email: "other-native@example.invalid", verified: true },
    wrong.authorizationURL,
  );
  const denied = await completeOAuth(auth, wrong, "wrong");
  expect(denied.headers.get("Location")).toContain("error");
  expect(
    await bindings.AUTH_DB.prepare(
      "SELECT generation FROM github_credential_state WHERE account_id=?",
    )
      .bind(account!.id)
      .first(),
  ).toEqual(before);
  const right = await beginOAuth(auth, flow.jar);
  provider.authorize(
    "right",
    { id: 7001, email: "native@example.invalid", verified: true },
    right.authorizationURL,
  );
  const success = await completeOAuth(auth, right, "right");
  expect(success.status).toBe(302);
  expect(
    await bindings.AUTH_DB.prepare(
      "SELECT generation FROM github_credential_state WHERE account_id=?",
    )
      .bind(account!.id)
      .first(),
  ).not.toEqual(before);
  const calls = provider.exchanges;
  for (const path of ["/api/auth/get-access-token", "/api/auth/refresh-token"])
    expect(
      (
        await auth.handleAuthRequest(
          new Request(testOrigin + path, {
            method: "POST",
            headers: flow.jar.headers(),
            body: "{}",
          }),
        )
      ).status,
    ).toBe(404);
  expect(provider.exchanges).toBe(calls);
});
