import { expect, it } from "vitest";

import {
  dashboardIdSchema,
  dashboardLocaleSchema,
  dashboardErrorSchema,
  sessionIdentitySchema,
  workspaceAccessSchema,
  deliveryWakeSchema,
  deliveryWakeResultSchema,
  workspaceDtoSchema,
  workspaceMembershipDtoSchema,
  createTeamWorkspaceInputSchema,
  personalWorkspaceInputSchema,
  sessionOutputDtoSchema,
  sessionDeviceDtoSchema,
  sessionDeviceListDtoSchema,
  revokeSessionInputSchema,
  revokeAllSessionsInputSchema,
  authSocialSignInInputSchema,
  authEnvironmentSchema,
  authRegisteredOriginsSchema,
  authEnabledSchema,
  githubAppAuthConfigSchema,
} from "../src/dashboard.js";
it("accepts only narrow DTOs, opaque IDs and documented errors", () => {
  expect(dashboardIdSchema.parse("opaque_123-ABC")).toBe("opaque_123-ABC");
  for (const id of ["", "../secret", "a".repeat(129), "a b", "<svg>"])
    expect(dashboardIdSchema.safeParse(id).success).toBe(false);
  for (const locale of ["en", "pt-BR"])
    expect(dashboardLocaleSchema.safeParse(locale).success).toBe(true);
  expect(dashboardLocaleSchema.safeParse("pt-PT").success).toBe(false);
  const identity = {
    userId: "synthetic-user",
    sessionId: "synthetic-session",
    expiresAt: "2030-01-01T00:00:00Z",
  };
  expect(sessionIdentitySchema.parse(identity)).toEqual(identity);
  expect(revokeSessionInputSchema.safeParse({}).success).toBe(true);
  expect(revokeSessionInputSchema.safeParse({ extra: 1 }).success).toBe(false);
  expect(revokeAllSessionsInputSchema.safeParse({}).success).toBe(true);
  expect(revokeAllSessionsInputSchema.safeParse({ extra: 1 }).success).toBe(
    false,
  );
  expect(
    sessionDeviceDtoSchema.safeParse({
      id: "opaque-1",
      createdAt: "2030-01-01T00:00:00.000Z",
      expiresAt: "2030-01-08T00:00:00.000Z",
      isCurrent: true,
      label: "chrome",
    }).success,
  ).toBe(true);
  expect(
    sessionDeviceListDtoSchema.safeParse({
      currentSessionId: "opaque-1",
      nextCursor: null,
      sessions: [
        {
          id: "opaque-1",
          createdAt: "2030-01-01T00:00:00.000Z",
          expiresAt: "2030-01-08T00:00:00.000Z",
          isCurrent: true,
          label: "chrome",
        },
      ],
    }).success,
  ).toBe(true);
  expect(
    sessionIdentitySchema.safeParse({ ...identity, token: "secret" }).success,
  ).toBe(false);
  expect(
    workspaceAccessSchema.parse({
      workspaceId: "synthetic-workspace",
      role: "owner",
    }).role,
  ).toBe("owner");
  expect(
    workspaceAccessSchema.safeParse({ workspaceId: "synthetic", role: "admin" })
      .success,
  ).toBe(false);
  expect(deliveryWakeSchema.parse({ operationId: "synthetic-op" })).toEqual({
    operationId: "synthetic-op",
  });
  expect(
    deliveryWakeSchema.safeParse({
      operationId: "synthetic-op",
      to: "private@example.invalid",
    }).success,
  ).toBe(false);
  expect(deliveryWakeResultSchema.parse({ status: "unavailable" })).toEqual({
    status: "unavailable",
  });
  expect(deliveryWakeResultSchema.safeParse({ status: "sent" }).success).toBe(
    false,
  );
  expect(
    dashboardErrorSchema.parse({
      error: {
        code: "command_unknown",
        requestId: "00000000-0000-4000-8000-000000000001",
      },
    }).error.code,
  ).toBe("command_unknown");
  expect(
    dashboardErrorSchema.safeParse({
      error: { code: "denied", requestId: "secret", message: "private" },
    }).success,
  ).toBe(false);

  // Tenancy schemas
  const ws = { id: "ws-1", type: "team" as const, name: "Acme" };
  expect(workspaceDtoSchema.parse(ws)).toEqual(ws);
  expect(workspaceDtoSchema.safeParse({ ...ws, type: "org" }).success).toBe(
    false,
  );
  expect(workspaceDtoSchema.safeParse({ ...ws, name: "" }).success).toBe(false);
  expect(workspaceDtoSchema.safeParse({ ...ws, extra: true }).success).toBe(
    false,
  );

  const membership = {
    workspaceId: "ws-1",
    userId: "u-1",
    role: "owner" as const,
  };
  expect(workspaceMembershipDtoSchema.parse(membership)).toEqual(membership);
  expect(
    workspaceMembershipDtoSchema.safeParse({ ...membership, role: "admin" })
      .success,
  ).toBe(false);
  expect(
    workspaceMembershipDtoSchema.safeParse({ ...membership, extra: 1 }).success,
  ).toBe(false);

  const teamInput = { name: "Engineering", operationId: "op-123" };
  expect(createTeamWorkspaceInputSchema.parse(teamInput)).toEqual(teamInput);
  expect(
    createTeamWorkspaceInputSchema.safeParse({ name: " ", operationId: "op-1" })
      .success,
  ).toBe(false);
  expect(
    createTeamWorkspaceInputSchema.safeParse({
      ...teamInput,
      operationId: "bad id!",
    }).success,
  ).toBe(false);

  expect(personalWorkspaceInputSchema.safeParse({}).success).toBe(true);
  expect(
    personalWorkspaceInputSchema.safeParse({ userId: "forged" }).success,
  ).toBe(false);
  expect(personalWorkspaceInputSchema.safeParse(null).success).toBe(false);
  expect(personalWorkspaceInputSchema.safeParse([]).success).toBe(false);
  expect(personalWorkspaceInputSchema.safeParse("invalid").success).toBe(false);
  expect(personalWorkspaceInputSchema.safeParse(42).success).toBe(false);

  // Session schemas
  const sessionOutput = {
    user: { id: "u-1", name: "Alice" },
    session: { id: "sess-1", expiresAt: "2030-01-01T00:00:00Z" },
  };
  expect(sessionOutputDtoSchema.parse(sessionOutput)).toEqual(sessionOutput);
  expect(
    sessionOutputDtoSchema.safeParse({ ...sessionOutput, token: "leak" })
      .success,
  ).toBe(false);

  const authSignIn = { provider: "github" as const, callbackURL: "/welcome" };
  expect(authSocialSignInInputSchema.parse(authSignIn)).toEqual(authSignIn);
  expect(
    authSocialSignInInputSchema.safeParse({ provider: "google" }).success,
  ).toBe(false);

  const appConfig = {
    clientId: "app_123",
    clientSecret: "secret_456",
    appOrigin: "https://example.invalid",
    environment: "production" as const,
  };
  expect(githubAppAuthConfigSchema.parse(appConfig)).toEqual(appConfig);
  expect(
    githubAppAuthConfigSchema.safeParse({
      ...appConfig,
      environment: "unknown",
    }).success,
  ).toBe(false);
  expect(
    githubAppAuthConfigSchema.safeParse({ ...appConfig, clientId: "" }).success,
  ).toBe(false);
  expect(
    githubAppAuthConfigSchema.safeParse({
      ...appConfig,
      appOrigin: "not-a-url",
    }).success,
  ).toBe(false);

  // Environment and origins schemas
  for (const env of ["development", "preview", "production"] as const) {
    expect(authEnvironmentSchema.parse(env)).toBe(env);
  }
  expect(authEnvironmentSchema.safeParse("staging").success).toBe(false);

  const origins = {
    preview: ["https://preview.example.invalid"],
    production: ["https://app.example.invalid"],
  };
  expect(authRegisteredOriginsSchema.parse(origins)).toEqual(origins);
  expect(
    authRegisteredOriginsSchema.safeParse({
      ...origins,
      preview: ["not-a-url"],
    }).success,
  ).toBe(false);
  expect(
    authRegisteredOriginsSchema.safeParse({
      production: ["https://app.example.invalid"],
    }).success,
  ).toBe(false);
  expect(
    authRegisteredOriginsSchema.safeParse({
      ...origins,
      extra: [],
    }).success,
  ).toBe(false);

  for (const enabled of ["true", "false"] as const) {
    expect(authEnabledSchema.parse(enabled)).toBe(enabled);
  }
  expect(authEnabledSchema.safeParse("yes").success).toBe(false);
  expect(authEnabledSchema.safeParse(true).success).toBe(false);
});
