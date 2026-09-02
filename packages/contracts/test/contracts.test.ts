import { describe, expect, it } from "vitest";

import {
  aggregatedReviewResultSchema,
  createCheckRunInputSchema,
  describeReviewScopeStatus,
  executorRequestSchema,
  executorRequestV1Schema,
  executorRequestV2Schema,
  githubCredentialRequestSchema,
  modelReviewOutputSchema,
  modelReviewTransportSchema,
  parseModelReviewTransport,
  preparedRepositorySchema,
  publicationRecordSchema,
  repositoryToolCallSchema,
  repositoryToolResultSchema,
  reviewContextSchema,
  reviewContextV1Schema,
  reviewContextV2Schema,
  reviewJobSchema,
  reviewPlanSchema,
  reviewShardSchema,
  shardReviewResultSchema,
  updateCheckRunInputSchema,
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

describe("webhook envelope and review job v2", () => {
  const envelope = {
    action: "synchronize",
    deliveryId: "github:delivery-newer",
    event: "pull_request",
    installationId: 99,
    pullRequest: {
      baseSha: "b".repeat(40),
      headSha: sha,
      number: 7,
      updatedAt: "2026-08-29T12:01:00.000Z",
    },
    receivedAt: "2026-08-29T12:01:01.000Z",
    repository: {
      fullName: "acme/api",
      id: 42,
      name: "api",
      owner: "acme",
    },
    schemaVersion: 2,
  } as const;

  it("carries a provider causal timestamp without invalidating drainable v1 messages", () => {
    expect(webhookEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(
      reviewJobSchema.parse({ envelope, runId, schemaVersion: 2 }),
    ).toMatchObject({ schemaVersion: 2 });
    expect(
      reviewJobSchema.safeParse({ envelope, runId, schemaVersion: 1 }).success,
    ).toBe(false);
  });
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

  it("keeps the deployed v1 RPC shapes valid while introducing an explicit v2", () => {
    const v1 = {
      baseSha: "b".repeat(40),
      canonicalDiff,
      cloneUrl: "https://github.com/acme/api.git",
      headSha: sha,
      pullRequestNumber: 7,
      repositoryId: 42,
      runId,
      schemaVersion: 1,
    } as const;
    const v2 = {
      ...v1,
      installationId: 99,
      repositoryName: "api",
      repositoryOwner: "acme",
      schemaVersion: 2,
    } as const;

    expect(executorRequestV1Schema.parse(v1)).toEqual(v1);
    expect(executorRequestV2Schema.parse(v2)).toEqual(v2);
    expect(executorRequestSchema.parse(v1)).toEqual(v1);
    expect(executorRequestSchema.parse(v2)).toEqual(v2);
    expect(
      executorRequestV2Schema.safeParse({ ...v2, repositoryName: "other" })
        .success,
    ).toBe(false);
    expect(
      preparedRepositorySchema.parse({
        changedLineCount: 1,
        contextBytes: 100,
        fileCount: 1,
        runId,
        schemaVersion: 2,
        truncated: false,
      }),
    ).toMatchObject({ schemaVersion: 2 });
  });

  it("enforces the v2 canonical diff budget in UTF-8 bytes", () => {
    expect(
      executorRequestV2Schema.safeParse({
        baseSha: "b".repeat(40),
        canonicalDiff: "😀".repeat(500_001),
        cloneUrl: "https://github.com/acme/api.git",
        headSha: sha,
        installationId: 99,
        pullRequestNumber: 7,
        repositoryId: 42,
        repositoryName: "api",
        repositoryOwner: "acme",
        runId,
        schemaVersion: 2,
      }).success,
    ).toBe(false);
  });

  it("validates the non-secret identity passed to the credential broker", () => {
    const request = {
      containerId: "sandbox-123",
      installationId: 99,
      repositoryId: 42,
      repositoryName: "api",
      repositoryOwner: "acme",
      runId,
    } as const;
    expect(githubCredentialRequestSchema.parse(request)).toEqual(request);
    const { installationId: _installationId, ...legacyRequest } = request;
    expect(githubCredentialRequestSchema.parse(legacyRequest)).toEqual(
      legacyRequest,
    );
    expect(
      githubCredentialRequestSchema.safeParse({
        ...request,
        token: "must-never-cross-this-boundary",
      }).success,
    ).toBe(false);
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
      files: [
        {
          mode: "structural",
          patch:
            "diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -9,0 +10,1 @@\n+const safe = true;\n",
          path: "src/index.ts",
        },
      ],
      schemaVersion: 2,
      truncated: false,
    } as const;
    expect(reviewContextV2Schema.parse(context)).toEqual(context);
    expect(reviewContextSchema.parse(context)).toEqual(context);
    expect(
      reviewContextV1Schema.parse({
        changedLines: context.changedLines,
        diff: context.files[0].patch,
        truncated: false,
      }),
    ).toMatchObject({ diff: context.files[0].patch });
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
      reviewContextSchema.safeParse({
        ...context,
        changedLines: [{ line: 10, path: "README.md", side: "RIGHT" }],
        files: [{ mode: "textual", patch: "+heading\n", path: "README.md" }],
        surface: [
          {
            change: "added",
            excerpt: "heading",
            kind: "contract",
            line: 10,
            path: "README.md",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      reviewContextSchema.safeParse({
        ...context,
        files: [{ mode: "textual", patch: "+heading\n", path: "README.md" }],
      }).success,
    ).toBe(false);
    expect(
      reviewContextSchema.safeParse({
        ...context,
        files: [
          { mode: "structural", patch: "+a\n", path: "src/index.ts" },
          { mode: "textual", patch: "+b\n", path: "src/index.ts" },
        ],
      }).success,
    ).toBe(false);
    expect(
      reviewContextV2Schema.safeParse({
        ...context,
        files: [
          {
            ...context.files[0],
            patch: "x".repeat(120_001),
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

  it("normalizes a provider-portable nullable transport before domain validation", () => {
    const transported = modelReviewTransportSchema.parse({
      findings: output.findings.map((finding) => ({
        ...finding,
        evidence: finding.evidence.map((evidence) => ({
          ...evidence,
          endLine: null,
        })),
        location: { ...finding.location, startLine: null },
        suggestion: finding.suggestion ?? null,
      })),
      summary: output.summary,
    });

    expect(parseModelReviewTransport(transported)).toEqual(output);
    expect(() =>
      parseModelReviewTransport({
        ...transported,
        findings: transported.findings.map((finding) => ({
          ...finding,
          evidence: finding.evidence.map((evidence) => ({
            ...evidence,
            endLine: evidence.startLine - 1,
          })),
        })),
      }),
    ).toThrow(/endLine must not precede/u);
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

describe("check run contracts", () => {
  it("validates check run creation input", () => {
    const valid = {
      externalId: runId,
      headSha: sha,
      name: "Holon Review",
      output: {
        summary: "Review is currently in progress...",
        title: "Holon Review in progress",
      },
      startedAt: "2026-08-29T12:00:00.000Z",
      status: "in_progress",
    } as const;

    expect(createCheckRunInputSchema.parse(valid)).toEqual(valid);
    expect(
      createCheckRunInputSchema.parse({
        externalId: runId,
        headSha: sha,
        status: "queued",
      }),
    ).toMatchObject({ status: "queued" });

    expect(
      createCheckRunInputSchema.safeParse({
        ...valid,
        headSha: "invalid-sha",
      }).success,
    ).toBe(false);
  });

  it("validates check run update input", () => {
    const update = {
      checkRunId: 101,
      completedAt: "2026-08-29T12:01:00.000Z",
      conclusion: "success",
      output: {
        summary: "No functional regressions found.",
        title: "Holon Review — No regressions",
      },
      status: "completed",
    } as const;

    expect(updateCheckRunInputSchema.parse(update)).toEqual(update);
    expect(
      updateCheckRunInputSchema.safeParse({
        ...update,
        checkRunId: -1,
      }).success,
    ).toBe(false);
  });

  it("validates review shard and plan schemas", () => {
    const shard = {
      byteLength: 250,
      changedLines: [{ line: 10, path: "src/a.ts", side: "RIGHT" }],
      files: [{ mode: "structural", patch: "diff content", path: "src/a.ts" }],
      id: "shard-0",
      index: 0,
      surface: [
        {
          change: "added",
          excerpt: "export function foo()",
          kind: "contract",
          line: 10,
          path: "src/a.ts",
        },
      ],
      totalShards: 1,
    } as const;

    expect(reviewShardSchema.parse(shard)).toEqual(shard);

    const plan = {
      omissionReasons: [],
      schemaVersion: 2,
      scopeStatus: "complete",
      shards: [shard],
      totalEligibleBytes: 250,
      totalEligibleFiles: 1,
      totalEligibleLines: 1,
      unsupportedFilesCount: 0,
    } as const;

    expect(reviewPlanSchema.parse(plan)).toEqual(plan);

    const shardResult = {
      findings: [],
      shardId: "shard-0",
      shardIndex: 0,
      status: "success",
      summary: "No issues in shard 0.",
    } as const;

    expect(shardReviewResultSchema.parse(shardResult)).toEqual(shardResult);

    const aggregated = {
      findings: [],
      omissionReasons: [],
      scopeStatus: "complete",
      shardsAnalyzed: 1,
      summary: "Consolidated review summary.",
      totalShards: 1,
    } as const;

    expect(aggregatedReviewResultSchema.parse(aggregated)).toEqual(aggregated);

    expect(describeReviewScopeStatus("complete")).toContain("Complete review");
    expect(describeReviewScopeStatus("partial_by_policy")).toContain(
      "Partial review bounded by deterministic host policy",
    );
    expect(describeReviewScopeStatus("partial_by_failure")).toContain(
      "Partial review due to model execution failure",
    );
    expect(describeReviewScopeStatus("unsupported")).toContain(
      "No eligible changes",
    );
  });
});
