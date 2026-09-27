import { expect, it } from "vitest";

import {
  documentationReferenceSchema,
  rawRepositoryPolicySchema,
  followUpMessageSchema,
} from "../src/index.js";
it("accepts scoped compatibility and rejects excess configuration or unsafe docs destinations", () => {
  const valid = {
    review: {
      instructions: ["Inspect authorization"],
      projects: [{ root: "apps/api", compatibility: { node: "22" } }],
    },
  };
  expect(rawRepositoryPolicySchema.safeParse(valid).success).toBe(true);
  expect(
    rawRepositoryPolicySchema.safeParse({
      review: {
        projects: [
          {
            root: ".",
            compatibility: Object.fromEntries(
              Array.from({ length: 21 }, (_, i) => [`lib${i}`, "1"]),
            ),
          },
        ],
      },
    }).success,
  ).toBe(false);
  const reference = {
    root: ".",
    technology: "node",
    version: "22.0.0",
    url: "https://nodejs.org/docs/v22.0.0/api/",
    sha256: "a".repeat(64),
  };
  expect(documentationReferenceSchema.safeParse(reference).success).toBe(true);
  for (const url of [
    "http://nodejs.org/api/",
    "https://nodejs.org:444/api/",
    "https://user:password@nodejs.org/api/",
    "https://nodejs.org/api/?token=secret",
    "https://nodejs.org/api/#fragment",
    "https://nodejs.org.attacker.test/api/",
  ])
    expect(
      documentationReferenceSchema.safeParse({ ...reference, url }).success,
    ).toBe(false);
});
it("validates feedback identity and applies its queue budget to UTF-8 bytes", () => {
  const payload = {
    action: "created",
    deliveryId: "github:delivery",
    installationId: 99,
    pullRequestNumber: 7,
    repository: { id: 42, name: "api", owner: "acme", fullName: "acme/api" },
    authorLogin: "alice",
    commentId: 1,
    createdAt: "2026-09-27T00:00:00Z",
    body: "false positive",
  };
  expect(
    followUpMessageSchema.safeParse({ event: "feedback_comment", payload })
      .success,
  ).toBe(true);
  expect(
    followUpMessageSchema.safeParse({
      event: "feedback_comment",
      payload: { ...payload, body: "界".repeat(50000) },
    }).success,
  ).toBe(false);
  expect(
    followUpMessageSchema.safeParse({
      event: "feedback_comment",
      payload: { ...payload, commentId: -1 },
    }).success,
  ).toBe(false);
});
