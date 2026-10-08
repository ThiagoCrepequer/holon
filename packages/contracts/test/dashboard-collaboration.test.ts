import { expect, it } from "vitest";

import {
  authSecretRingSchema,
  connectionCommandSchema,
  connectionReauthSchema,
  createInvitationSchema,
  githubAccessEventSchema,
  githubRefreshSchema,
} from "../src/dashboard-collaboration.js";
it("invitation normalizes only surrounding whitespace and case, preserving plus and dots", () => {
  expect(
    createInvitationSchema.parse({
      operationId: "op",
      email: " A.B+tag@Example.invalid ",
      locale: "pt-BR",
    }),
  ).toMatchObject({ email: "a.b+tag@example.invalid" });
  for (const email of ["", "invalid", "x".repeat(260) + "@example.invalid"])
    expect(
      createInvitationSchema.safeParse({
        operationId: "op",
        email,
        locale: "en",
      }).success,
    ).toBe(false);
  expect(
    createInvitationSchema.safeParse({
      operationId: "op",
      email: "a@example.invalid",
      locale: "en",
      role: "owner",
    }).success,
  ).toBe(false);
});
it("connection requires stable positive IDs and server-held scoped reauth", () => {
  expect(
    connectionCommandSchema.safeParse({
      installationId: 77,
      reauthIntentId: "proof",
    }).success,
  ).toBe(true);
  for (const installationId of [0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1, "77"])
    expect(
      connectionCommandSchema.safeParse({
        installationId,
        reauthIntentId: "proof",
      }).success,
    ).toBe(false);
  expect(
    connectionReauthSchema.safeParse({
      installationId: 77,
      workspaceId: "workspace",
      action: "link",
    }).success,
  ).toBe(true);
  expect(
    connectionReauthSchema.safeParse({
      installationId: 77,
      workspaceId: "workspace",
      action: "transfer",
    }).success,
  ).toBe(false);
});
it("access events distinguish user revocation from installation invalidation with a durable delivery identity", () => {
  expect(
    githubAccessEventSchema.safeParse({
      deliveryId: "delivery",
      installationId: 77,
      action: "suspended",
    }).success,
  ).toBe(true);
  expect(
    githubAccessEventSchema.safeParse({
      deliveryId: "delivery",
      githubAccountId: "101",
      action: "user_revoked",
    }).success,
  ).toBe(true);
  expect(
    githubAccessEventSchema.safeParse({
      deliveryId: "delivery",
      action: "user_revoked",
    }).success,
  ).toBe(false);
  expect(
    githubAccessEventSchema.safeParse({
      installationId: 77,
      action: "suspended",
    }).success,
  ).toBe(false);
});
it("refresh and key-ring contracts reject incomplete outcomes and duplicate versions", () => {
  expect(
    githubRefreshSchema.safeParse({
      access_token: "synthetic",
      refresh_token: "synthetic",
      expires_in: 28800,
      refresh_token_expires_in: 15897600,
      token_type: "bearer",
    }).success,
  ).toBe(true);
  expect(
    githubRefreshSchema.safeParse({ access_token: "synthetic" }).success,
  ).toBe(false);
  expect(
    authSecretRingSchema.safeParse([
      { version: 1, value: "synthetic-secret-with-at-least-32-chars" },
    ]).success,
  ).toBe(true);
  expect(
    authSecretRingSchema.safeParse([
      { version: 1, value: "synthetic-secret-with-at-least-32-chars" },
      { version: 1, value: "another-secret-with-at-least-32-chars" },
    ]).success,
  ).toBe(false);
});
