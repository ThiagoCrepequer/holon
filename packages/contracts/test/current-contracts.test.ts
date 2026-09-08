import { expect, it } from "vitest";

import { reviewContextSchema, webhookEnvelopeSchema } from "../src/index.js";

it("rejects retired diff-only contexts", () => {
  expect(
    reviewContextSchema.safeParse({ changedLines: [], diff: "" }).success,
  ).toBe(false);
});
it("requires causal PR time instead of accepting the old envelope", () => {
  expect(
    webhookEnvelopeSchema.safeParse({
      action: "opened",
      deliveryId: "github:delivery-contract-test",
      event: "pull_request",
      installationId: 1,
      receivedAt: "2026-09-08T00:00:00Z",
      schemaVersion: 1,
      repository: { fullName: "acme/api", id: 1, name: "api", owner: "acme" },
      pullRequest: {
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
        number: 1,
      },
    }).success,
  ).toBe(false);
});

it("requires evidence identity and confidence in persisted findings", async () => {
  const { trackedFindingSchema } = await import("../src/index.js");
  const finding = {
    evidenceFingerprint: "e".repeat(64),
    confidence: 0.9,
    diagnostic: "The new nullable value is dereferenced without checking.",
    filePath: "src/index.ts",
    fingerprint: `fp:${"a".repeat(64)}`,
    firstSeenHeadSha: "b".repeat(40),
    lastSeenHeadSha: "b".repeat(40),
    firstSeenRunId: `github:1:pr:1:head:${"b".repeat(40)}`,
    lastSeenRunId: `github:1:pr:1:head:${"b".repeat(40)}`,
    line: 1,
    prKey: "github:1:pr:1",
    severity: "high",
    status: "new",
    updatedAt: "2026-09-08T00:00:00Z",
  };
  expect(trackedFindingSchema.safeParse(finding).success).toBe(true);
  for (const key of ["evidenceFingerprint", "confidence"] as const) {
    const incomplete = { ...finding, [key]: undefined };
    expect(trackedFindingSchema.safeParse(incomplete).success).toBe(false);
  }
});
