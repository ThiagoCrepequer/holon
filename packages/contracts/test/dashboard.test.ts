import { expect, it } from "vitest";

import {
  dashboardIdSchema,
  dashboardLocaleSchema,
  dashboardErrorSchema,
  sessionIdentitySchema,
  workspaceAccessSchema,
  deliveryWakeSchema,
  deliveryWakeResultSchema,
  reviewPageSchema,
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
});

it("review pages contain bounded metadata without credential or ORM leakage", () => {
  const item = {
    runId: "synthetic-run",
    repositoryId: 123,
    pullRequestNumber: 1,
    state: "running",
    updatedAt: "2030-01-01T00:00:00Z",
  };
  expect(reviewPageSchema.parse({ items: [item], nextCursor: null })).toEqual({
    items: [item],
    nextCursor: null,
  });
  for (const invalid of [
    { ...item, repositoryId: 0 },
    { ...item, runId: "../private" },
    { ...item, state: "unknown" },
    { ...item, token: "secret" },
    { ...item, updatedAt: "yesterday" },
  ])
    expect(
      reviewPageSchema.safeParse({ items: [invalid], nextCursor: null })
        .success,
    ).toBe(false);
  expect(
    reviewPageSchema.safeParse({
      items: Array.from({ length: 51 }, () => item),
      nextCursor: null,
    }).success,
  ).toBe(false);
  expect(
    reviewPageSchema.safeParse({ items: [], nextCursor: "x".repeat(513) })
      .success,
  ).toBe(false);
});
