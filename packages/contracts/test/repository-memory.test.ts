import { expect, it } from "vitest";

import {
  memorySnapshotSchema,
  memoryObservationSchema,
  memoryRunIdentitySchema,
  memoryCommandSchema,
  investigationObservationSchema,
  parseModelReviewTransport,
} from "../src/index.js";
const headSha = "a".repeat(40),
  baseSha = "b".repeat(40);
const source = {
  installationId: 99,
  repositoryId: 42,
  pullRequestNumber: 7,
  headSha,
  baseSha,
  runId: `github:42:pr:7:head:${headSha}:base:${baseSha}`,
};
const observation = {
  id: "finding:1",
  kind: "finding",
  source,
  path: "src/index.ts",
  summary: "Gateway validates authorization.",
  createdAt: "2026-10-04T00:00:00Z",
};
const rule = {
  id: "c".repeat(64),
  digest: "c".repeat(64),
  topic: "d".repeat(64),
  root: "src",
  guidance: "Check the gateway before reporting missing authorization.",
  evidence: [observation],
  state: "active",
  createdAt: observation.createdAt,
  expiresAt: "2027-01-04T00:00:00Z",
  decidedBy: "alice",
  decidedAt: observation.createdAt,
};
const snapshot = {
  identity: source,
  memoryName: "99/42",
  revision: 1,
  capturedAt: observation.createdAt,
  expiresAt: "2026-11-04T00:00:00Z",
  rules: [rule],
  observations: [observation],
};
it("validates one repository identity across rule evidence, observations and the run", () => {
  expect(memorySnapshotSchema.parse(snapshot)).toEqual(snapshot);
  expect(
    memoryRunIdentitySchema.safeParse({ ...source, repositoryId: 99 }).success,
  ).toBe(false);
  expect(
    memorySnapshotSchema.safeParse({
      ...snapshot,
      observations: [
        { ...observation, source: { ...source, installationId: 100 } },
      ],
    }).success,
  ).toBe(false);
  expect(
    memorySnapshotSchema.safeParse({
      ...snapshot,
      rules: [
        {
          ...rule,
          evidence: [
            { ...observation, source: { ...source, installationId: 100 } },
          ],
        },
      ],
    }).success,
  ).toBe(false);
});
it("requires an active human decision for every rule admitted to a snapshot", () => {
  expect(
    memorySnapshotSchema.safeParse({
      ...snapshot,
      rules: [{ ...rule, state: "proposed" }],
    }).success,
  ).toBe(false);
  expect(
    memorySnapshotSchema.safeParse({
      ...snapshot,
      rules: [{ ...rule, decidedBy: undefined }],
    }).success,
  ).toBe(false);
  expect(
    memorySnapshotSchema.safeParse({
      ...snapshot,
      rules: [{ ...rule, decidedAt: undefined }],
    }).success,
  ).toBe(false);
});
it("requires human provenance for feedback and rejects unknown fields and unsafe paths", () => {
  expect(
    memoryObservationSchema.safeParse({ ...observation, kind: "feedback" })
      .success,
  ).toBe(false);
  expect(
    memoryObservationSchema.safeParse({
      ...observation,
      kind: "feedback",
      authorLogin: "alice",
      commentId: 42,
      label: "helpful",
    }).success,
  ).toBe(true);
  expect(
    memoryObservationSchema.safeParse({
      ...observation,
      prompt: "private prompt",
    }).success,
  ).toBe(false);
  expect(
    memoryObservationSchema.safeParse({ ...observation, path: "../private" })
      .success,
  ).toBe(false);
  expect(
    memoryCommandSchema.safeParse({
      action: "propose",
      root: "../private",
      guidance: "Read private files",
    }).success,
  ).toBe(false);
});
it("retains bounded discoveries through the current model transport", () => {
  const discovery = {
    path: "src/index.ts",
    line: 10,
    summary: "This branch skips gateway authorization before returning.",
    excerpt: "return null;",
  };
  expect(
    parseModelReviewTransport({
      findings: [],
      investigations: [discovery],
      summary: "Review complete.",
    }).investigations,
  ).toEqual([discovery]);
  expect(
    investigationObservationSchema.safeParse({ ...discovery, line: 0 }).success,
  ).toBe(false);
  expect(() =>
    parseModelReviewTransport({
      findings: [],
      investigations: Array.from({ length: 5 }, () => discovery),
      summary: "Review complete.",
    }),
  ).toThrow();
});
