import { describe, expect, it } from "vitest";

import {
  executorRequestSchema,
  modelReviewOutputSchema,
  publicationRecordSchema,
  repositoryToolCallSchema,
  repositoryToolResultSchema,
  reviewContextSchema,
  reviewJobSchema,
  webhookEnvelopeSchema,
} from "../src/index.js";

const sha = "a".repeat(40);
const runId = `github:42:pr:7:head:${sha}`;
const canonicalDiff =
  "diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-old\n+new\n";

describe("webhook envelope v1", () => {
  const envelope = {
    action: "synchronize",
    deliveryId: "github:delivery-123",
    event: "pull_request",
    installationId: 99,
    pullRequest: { baseSha: "b".repeat(40), headSha: sha, number: 7 },
    receivedAt: "2026-08-29T12:00:00.000Z",
    repository: { fullName: "acme/api", id: 42, name: "api", owner: "acme" },
    schemaVersion: 1,
  } as const;

  it("accepts and serializes the minimal provider-independent message", () => {
    expect(
      webhookEnvelopeSchema.parse(JSON.parse(JSON.stringify(envelope))),
    ).toEqual(envelope);
  });

  it.each([
    { ...envelope, schemaVersion: 2 },
    { ...envelope, installationToken: "secret" },
    {
      ...envelope,
      pullRequest: { ...envelope.pullRequest, headSha: "invalid" },
    },
    { ...envelope, action: "closed" },
    {
      ...envelope,
      repository: { ...envelope.repository, fullName: "other/api" },
    },
    {
      ...envelope,
      repository: { ...envelope.repository, name: "../api" },
    },
  ])(
    "rejects incompatible, secret-bearing or irrelevant messages",
    (invalid) => {
      expect(webhookEnvelopeSchema.safeParse(invalid).success).toBe(false);
    },
  );
});

describe("review job and executor contracts", () => {
  const job = {
    envelope: {
      action: "opened",
      deliveryId: "github:delivery-123",
      event: "pull_request",
      installationId: 99,
      pullRequest: { baseSha: "b".repeat(40), headSha: sha, number: 7 },
      receivedAt: "2026-08-29T12:00:00.000Z",
      repository: { fullName: "acme/api", id: 42, name: "api", owner: "acme" },
      schemaVersion: 1,
    },
    runId,
    schemaVersion: 1,
  } as const;

  it("requires the run identity to match the webhook coordinates", () => {
    expect(reviewJobSchema.parse(job)).toEqual(job);
    expect(
      reviewJobSchema.safeParse({ ...job, runId: `github:43:pr:7:head:${sha}` })
        .success,
    ).toBe(false);
  });

  it("accepts an exact-SHA, read-only executor request without credentials", () => {
    expect(
      executorRequestSchema.parse({
        baseSha: "b".repeat(40),
        canonicalDiff,
        cloneUrl: "https://github.com/acme/api.git",
        headSha: sha,
        pullRequestNumber: 7,
        repositoryId: 42,
        runId,
        schemaVersion: 1,
      }),
    ).not.toHaveProperty("token");
  });

  it("rejects executor coordinates that do not describe the run", () => {
    expect(
      executorRequestSchema.safeParse({
        baseSha: "b".repeat(40),
        canonicalDiff,
        cloneUrl: "https://github.com/acme/api.git",
        headSha: sha,
        pullRequestNumber: 7,
        repositoryId: 43,
        runId,
        schemaVersion: 1,
      }).success,
    ).toBe(false);
  });

  it.each([
    "https://token@github.com/acme/api.git",
    "https://github.com/acme/api.git?token=secret",
    "https://github.com/acme/api.git#fragment",
    "https://github.com/acme/api/extra.git",
  ])("rejects unsafe clone URL %s", (cloneUrl) => {
    expect(
      executorRequestSchema.safeParse({
        baseSha: "b".repeat(40),
        canonicalDiff,
        cloneUrl,
        headSha: sha,
        pullRequestNumber: 7,
        repositoryId: 42,
        runId,
        schemaVersion: 1,
      }).success,
    ).toBe(false);
  });
});

describe("bounded repository tools", () => {
  it.each([
    {
      arguments: { endLine: 20, path: "src/index.ts", startLine: 10 },
      name: "read_file",
    },
    {
      arguments: { maxResults: 20, query: "createUser(" },
      name: "search_text",
    },
    {
      arguments: {
        language: "typescript",
        maxResults: 20,
        pattern: "function $F($$$A) { $$$B }",
      },
      name: "search_structure",
    },
  ])("accepts tool call $name", (call) => {
    expect(repositoryToolCallSchema.safeParse(call).success).toBe(true);
  });

  it.each([
    { arguments: { command: "npm install" }, name: "shell" },
    { arguments: { maxResults: 10_000, query: "secret" }, name: "search_text" },
    { arguments: { path: "../../etc/passwd" }, name: "read_file" },
    {
      arguments: { endLine: 10, path: "src/index.ts", startLine: 20 },
      name: "read_file",
    },
    {
      arguments: { endLine: 700, path: "src/index.ts", startLine: 1 },
      name: "read_file",
    },
    {
      arguments: { endLine: 501, path: "src/index.ts" },
      name: "read_file",
    },
    {
      arguments: { endLine: 510, path: "src/index.ts", startLine: 10 },
      name: "read_file",
    },
    { arguments: { path: "/etc/passwd" }, name: "read_file" },
    { arguments: { path: "src\\index.ts" }, name: "read_file" },
    { arguments: { path: "src//index.ts" }, name: "read_file" },
  ])("rejects unsafe or unbounded tool call $name", (call) => {
    expect(repositoryToolCallSchema.safeParse(call).success).toBe(false);
  });

  it("validates bounded executor results before they reach the model", () => {
    const context = {
      changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
      diff: "+const safe = true;",
      truncated: false,
    };
    expect(reviewContextSchema.parse(context)).toEqual(context);
    expect(
      repositoryToolResultSchema.parse({ content: "match", truncated: false }),
    ).toEqual({
      content: "match",
      truncated: false,
    });
    expect(
      reviewContextSchema.safeParse({
        ...context,
        surface: [
          {
            change: "added",
            excerpt: "secret",
            kind: "security",
            line: 1,
            path: "../secret",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      repositoryToolResultSchema.safeParse({
        content: "x".repeat(100_001),
        truncated: false,
      }).success,
    ).toBe(false);
  });
});

describe("model output and publication ledger", () => {
  const output = {
    findings: [
      {
        confidence: 0.91,
        diagnostic:
          "The unchanged caller still sends the removed argument and will fail.",
        evidence: [
          {
            excerpt: "parse(value, options)",
            path: "src/caller.ts",
            reason: "Unchanged caller",
            startLine: 30,
          },
        ],
        location: { line: 10, path: "src/index.ts", side: "RIGHT" },
        severity: "high",
        suggestion: "Update the caller before merging.",
      },
    ],
    summary: "One contract regression was found.",
  };

  it("accepts structured findings and rejects extra model prose", () => {
    expect(modelReviewOutputSchema.parse(output)).toEqual(output);
    expect(
      modelReviewOutputSchema.safeParse({
        ...output,
        chainOfThought: "private reasoning",
      }).success,
    ).toBe(false);
  });

  it("keeps the largest valid model result below the Workflow step limit", () => {
    const maximumFinding = {
      confidence: 1,
      diagnostic: "d".repeat(600),
      evidence: Array.from({ length: 2 }, () => ({
        excerpt: "e".repeat(300),
        path: "p".repeat(1_024),
        reason: "r".repeat(200),
        startLine: 1,
      })),
      location: { line: 1, path: "p".repeat(1_024), side: "RIGHT" },
      severity: "critical",
      suggestion: "s".repeat(800),
    };
    const maximumOutput = modelReviewOutputSchema.parse({
      findings: Array.from({ length: 3 }, () => maximumFinding),
      summary: "s".repeat(800),
    });
    expect(JSON.stringify(maximumOutput).length).toBeLessThan(1_000_000);
  });

  it("validates publication reconciliation data", () => {
    const findingId = `finding:${"c".repeat(64)}`;
    expect(
      publicationRecordSchema.parse({
        findingId,
        githubCommentId: 1234,
        kind: "inline",
        marker: `<!-- holon:v1;run=${encodeURIComponent(runId)};finding=${encodeURIComponent(findingId)} -->`,
        id: `${runId}:publication:${findingId}`,
        runId,
        state: "published",
      }),
    ).toMatchObject({ githubCommentId: 1234, state: "published" });
  });

  it.each([
    {
      findingId: "summary",
      githubCommentId: 123,
      kind: "summary",
      id: `${runId}:publication:wrong`,
      state: "published",
    },
    {
      findingId: `finding:${"c".repeat(64)}`,
      githubCommentId: 123,
      kind: "summary",
      id: `${runId}:publication:finding:${"c".repeat(64)}`,
      state: "published",
    },
    {
      findingId: "summary",
      kind: "summary",
      id: `${runId}:publication:summary`,
      state: "published",
    },
  ])("rejects inconsistent publication record", (record) => {
    expect(
      publicationRecordSchema.safeParse({
        ...record,
        marker: `<!-- holon:v1;run=${encodeURIComponent(runId)};finding=${encodeURIComponent(record.findingId)} -->`,
        runId,
      }).success,
    ).toBe(false);
  });

  it("rejects evidence with a reversed line interval", () => {
    const invalidOutput = {
      ...output,
      findings: [
        {
          ...output.findings[0]!,
          evidence: [
            { ...output.findings[0]!.evidence[0]!, endLine: 20, startLine: 30 },
          ],
        },
      ],
    };
    expect(modelReviewOutputSchema.safeParse(invalidOutput).success).toBe(
      false,
    );
  });

  it("rejects a finding whose multiline start is after its anchor", () => {
    const invalidOutput = {
      ...output,
      findings: [
        {
          ...output.findings[0]!,
          location: {
            ...output.findings[0]!.location,
            line: 10,
            startLine: 11,
          },
        },
      ],
    };
    expect(modelReviewOutputSchema.safeParse(invalidOutput).success).toBe(
      false,
    );
  });
});
