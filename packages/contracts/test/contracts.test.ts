import { describe, expect, it } from "vitest";

import {
  aggregatedReviewResultSchema,
  calibrationMetricsSchema,
  ciEvidenceSchema,
  createCheckRunInputSchema,
  executorRequestSchema,
  feedbackLabelSchema,
  findingFeedbackRecordSchema,
  findingFingerprintSchema,
  findingStatusSchema,
  lineCoverageSchema,
  parsedFeedbackCommandSchema,
  testExecutionReportSchema,
  githubCredentialRequestSchema,
  isProtectedPath,
  modelReviewOutputSchema,
  modelReviewTransportSchema,
  parseModelReviewTransport,
  preparedRepositorySchema,
  publicationRecordSchema,
  repositoryConfigInputSchema,
  reconciledFindingSchema,
  reconciliationSummarySchema,
  repositoryPolicyGlobSchema,
  repositoryPolicySchema,
  repositoryToolCallSchema,
  repositoryToolResultSchema,
  reviewContextSchema,
  reviewShardContextSchema,
  reviewJobSchema,
  reviewPlanSchema,
  runClaimResultSchema,
  reviewShardSchema,
  reviewVerdictDetailsSchema,
  reviewVerdictPolicyOptionsSchema,
  reviewVerdictSchema,
  shardReviewResultSchema,
  structuralImpactReportSchema,
  changedSymbolSchema,
  downstreamReferenceSchema,
  contractBreakSignalSchema,
  testGapSignalSchema,
  securitySurfaceSignalSchema,
  healthCheckReportSchema,
  trackedFindingSchema,
  updateCheckRunInputSchema,
  webhookEnvelopeSchema,
} from "../src/index.js";

const sha = "a".repeat(40);
const runId = `github:42:pr:7:head:${sha}:base:${"b".repeat(40)}`;
const canonicalDiff =
  "diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-old\n+new\n";

describe("run claim", () => {
  const claim = {
    outcome: "claimed",
    supersededWorkflows: [
      {
        runId,
        workflowInstanceId: "review-previous",
      },
    ],
  } as const;

  it("accepts a bounded list of superseded workflow identities", () => {
    expect(runClaimResultSchema.parse(claim)).toEqual(claim);
  });

  it.each([
    { ...claim, extra: true },
    {
      ...claim,
      supersededWorkflows: Array.from({ length: 101 }, (_, index) => ({
        runId,
        workflowInstanceId: `review-${index}`,
      })),
    },
    {
      ...claim,
      supersededWorkflows: [{ runId: "invalid", workflowInstanceId: "" }],
    },
  ])("rejects an invalid supersession boundary", (invalid) => {
    expect(runClaimResultSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("webhook envelope", () => {
  const envelope = {
    action: "synchronize",
    deliveryId: "github:delivery-123",
    event: "pull_request",
    installationId: 99,
    pullRequest: {
      baseSha: "b".repeat(40),
      headSha: sha,
      number: 7,
      updatedAt: "2026-08-29T12:00:00.000Z",
    },
    receivedAt: "2026-08-29T12:00:00.000Z",
    repository: { fullName: "acme/api", id: 42, name: "api", owner: "acme" },
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

describe("webhook envelope and review job", () => {
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
  } as const;

  it("carries a provider causal timestamp and rejects retired version tags", () => {
    expect(webhookEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(reviewJobSchema.parse({ envelope, runId })).toMatchObject({ runId });
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
      pullRequest: {
        baseSha: "b".repeat(40),
        headSha: sha,
        number: 7,
        updatedAt: "2026-08-29T12:00:00.000Z",
      },
      receivedAt: "2026-08-29T12:00:00.000Z",
      repository: { fullName: "acme/api", id: 42, name: "api", owner: "acme" },
    },
    runId,
  } as const;

  it("requires the run identity to match the webhook coordinates", () => {
    expect(reviewJobSchema.parse(job)).toEqual(job);
    expect(
      reviewJobSchema.safeParse({
        ...job,
        runId: `github:43:pr:7:head:${sha}:base:${"b".repeat(40)}`,
      }).success,
    ).toBe(false);
  });

  it("accepts an exact-SHA, read-only executor request without credentials", () => {
    expect(
      executorRequestSchema.parse({
        effectivePolicy: {
          additionalExcludes: [],
          baseSha: "b".repeat(40),
          effectivePolicyDigest: "c".repeat(64),
          source: "default",
          sourceDigest: null,
          verdictStrictness: "default",
        },
        installationId: 99,
        repositoryOwner: "acme",
        repositoryName: "api",
        baseSha: "b".repeat(40),
        canonicalDiff,
        cloneUrl: "https://github.com/acme/api.git",
        headSha: sha,
        pullRequestNumber: 7,
        repositoryId: 42,
        runId,
      }),
    ).not.toHaveProperty("token");
  });

  it("requires installation coordinates and effective policy in executor requests", () => {
    const withoutInstallation = {
      baseSha: "b".repeat(40),
      canonicalDiff,
      cloneUrl: "https://github.com/acme/api.git",
      headSha: sha,
      pullRequestNumber: 7,
      repositoryId: 42,
      runId,
    } as const;
    const withoutPolicy = {
      ...withoutInstallation,
      installationId: 99,
      repositoryName: "api",
      repositoryOwner: "acme",
    } as const;
    const policy = {
      additionalExcludes: ["vendor/**", "dist/**"],
      baseSha: "b".repeat(40),
      effectivePolicyDigest: "c".repeat(64),
      source: ".github/holon.yml" as const,
      sourceDigest: "d".repeat(64),
      verdictStrictness: "block_all_confident_medium" as const,
    };
    const currentRequest = {
      ...withoutPolicy,
      effectivePolicy: policy,
    } as const;

    expect(executorRequestSchema.safeParse(withoutInstallation).success).toBe(
      false,
    );
    expect(executorRequestSchema.safeParse(withoutPolicy).success).toBe(false);
    expect(executorRequestSchema.parse(currentRequest)).toEqual(currentRequest);
    expect(
      executorRequestSchema.safeParse({
        ...currentRequest,
        repositoryName: "other",
      }).success,
    ).toBe(false);
    expect(
      preparedRepositorySchema.parse({
        effectivePolicyDigest: "c".repeat(64),
        waiversCount: 0,
        changedLineCount: 1,
        contextBytes: 100,
        fileCount: 1,
        runId,
        truncated: false,
      }),
    ).toMatchObject({ runId });
    expect(
      preparedRepositorySchema.parse({
        changedLineCount: 1,
        contextBytes: 100,
        effectivePolicyDigest: "c".repeat(64),
        fileCount: 1,
        runId,
        truncated: false,
        waiversCount: 3,
      }),
    ).toMatchObject({ waiversCount: 3 });
  });

  it("enforces the canonical diff byte budget and clone URL matching", () => {
    const valid = {
      baseSha: "b".repeat(40),
      canonicalDiff: canonicalDiff,
      cloneUrl: "https://github.com/acme/api.git",
      effectivePolicy: {
        additionalExcludes: [],
        baseSha: "b".repeat(40),
        effectivePolicyDigest: "c".repeat(64),
        source: "default" as const,
        sourceDigest: null,
        verdictStrictness: "default" as const,
      },
      headSha: sha,
      installationId: 99,
      pullRequestNumber: 7,
      repositoryId: 42,
      repositoryName: "api",
      repositoryOwner: "acme",
      runId,
    };
    expect(executorRequestSchema.parse(valid)).toEqual(valid);

    expect(
      executorRequestSchema.safeParse({
        ...valid,
        canonicalDiff: "😀".repeat(500_001),
      }).success,
    ).toBe(false);

    expect(
      executorRequestSchema.safeParse({
        ...valid,
        cloneUrl: "https://github.com/acme/other.git",
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
    expect(githubCredentialRequestSchema.safeParse(legacyRequest).success).toBe(
      false,
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
      truncated: false,
    } as const;
    expect(reviewShardContextSchema.parse(context)).toEqual(context);
    expect(reviewShardContextSchema.parse(context)).toEqual(context);
    expect(
      reviewShardContextSchema.safeParse({
        changedLines: context.changedLines,
        diff: context.files[0].patch,
        truncated: false,
      }).success,
    ).toBe(false);
    expect(
      repositoryToolResultSchema.parse({ content: "match", truncated: false }),
    ).toEqual({
      content: "match",
      truncated: false,
    });
    expect(
      reviewShardContextSchema.safeParse({
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
      reviewShardContextSchema.safeParse({
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
      reviewShardContextSchema.safeParse({
        ...context,
        files: [{ mode: "textual", patch: "+heading\n", path: "README.md" }],
      }).success,
    ).toBe(false);
    expect(
      reviewShardContextSchema.safeParse({
        ...context,
        files: [
          { mode: "structural", patch: "+a\n", path: "src/index.ts" },
          { mode: "textual", patch: "+b\n", path: "src/index.ts" },
        ],
      }).success,
    ).toBe(false);
    expect(
      reviewShardContextSchema.safeParse({
        ...context,
        files: [
          {
            ...context.files[0],
            patch: "x".repeat(120_001),
          },
        ],
      }).success,
    ).toBe(false);

    const policyContext = {
      ...context,
      effectivePolicyDigest: "e".repeat(64),
      policySource: ".github/holon.yml" as const,
      sourceDigest: "f".repeat(64),
      verdictStrictness: "default" as const,
      waiversCount: 2,
    } as const;
    expect(reviewContextSchema.parse(policyContext)).toEqual(policyContext);
    expect(
      reviewContextSchema.safeParse({
        ...policyContext,
        policySource: "unsupported" as never,
      }).success,
    ).toBe(false);

    expect(
      reviewContextSchema.safeParse({
        ...policyContext,
        files: [
          ...policyContext.files,
          { mode: "textual", patch: "+extra\n", path: "src/index.ts" },
        ],
      }).success,
    ).toBe(false);

    expect(
      reviewContextSchema.safeParse({
        ...policyContext,
        files: [
          {
            ...policyContext.files[0],
            patch: "x".repeat(2_000_001),
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      reviewContextSchema.safeParse({
        ...policyContext,
        changedLines: [{ line: 1, path: "unknown.ts", side: "RIGHT" }],
      }).success,
    ).toBe(false);

    expect(
      reviewContextSchema.safeParse({
        ...policyContext,
        files: [
          {
            mode: "textual",
            patch: "+content\n",
            path: "README.md",
          },
        ],
        changedLines: [{ line: 1, path: "README.md", side: "RIGHT" }],
        surface: [
          {
            change: "added",
            excerpt: "heading",
            kind: "contract",
            line: 1,
            path: "README.md",
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

describe("declarative repository policy contracts", () => {
  it("identifies protected policy, workflow, security, and ownership paths", () => {
    expect(isProtectedPath(".github/holon.yml")).toBe(true);
    expect(isProtectedPath(".github/holon.yaml")).toBe(true);
    expect(isProtectedPath(".holon.yml")).toBe(true);
    expect(isProtectedPath(".holon.yaml")).toBe(true);
    expect(isProtectedPath(".github/workflows/ci.yml")).toBe(true);
    expect(isProtectedPath(".github/workflows")).toBe(true);
    expect(isProtectedPath("SECURITY.md")).toBe(true);
    expect(isProtectedPath("security.md")).toBe(true);
    expect(isProtectedPath(".github/SECURITY.md")).toBe(true);
    expect(isProtectedPath("CODEOWNERS")).toBe(true);
    expect(isProtectedPath(".github/CODEOWNERS")).toBe(true);
    expect(isProtectedPath("docs/CODEOWNERS")).toBe(true);

    expect(isProtectedPath("src/index.ts")).toBe(false);
    expect(isProtectedPath("README.md")).toBe(false);
    expect(isProtectedPath("docs/architecture/README.md")).toBe(false);
  });

  it("validates and restricts policy exclusion glob patterns", () => {
    expect(repositoryPolicyGlobSchema.parse("vendor/**")).toBe("vendor/**");
    expect(repositoryPolicyGlobSchema.parse("generated/*.go")).toBe(
      "generated/*.go",
    );
    expect(repositoryPolicyGlobSchema.parse("fixtures/data.json")).toBe(
      "fixtures/data.json",
    );

    // Universal wildcards prohibited
    expect(repositoryPolicyGlobSchema.safeParse("*").success).toBe(false);
    expect(repositoryPolicyGlobSchema.safeParse("**").success).toBe(false);
    expect(repositoryPolicyGlobSchema.safeParse("**/*").success).toBe(false);
    expect(repositoryPolicyGlobSchema.safeParse("*/*").success).toBe(false);
    expect(repositoryPolicyGlobSchema.safeParse("****").success).toBe(false);
    expect(repositoryPolicyGlobSchema.safeParse("?*").success).toBe(false);
    expect(repositoryPolicyGlobSchema.safeParse("**/?*").success).toBe(false);

    // Globs that semantically reach protected paths are prohibited
    for (const glob of [
      ".github/*.yml",
      ".github/**",
      ".github/workflows/*.json",
      "**/CODEOWNERS",
      "SECURITY.?d",
    ]) {
      expect(repositoryPolicyGlobSchema.safeParse(glob).success).toBe(false);
    }

    // Path traversal prohibited
    expect(repositoryPolicyGlobSchema.safeParse("../secret").success).toBe(
      false,
    );
    expect(repositoryPolicyGlobSchema.safeParse("foo/../../bar").success).toBe(
      false,
    );

    // Absolute paths prohibited
    expect(repositoryPolicyGlobSchema.safeParse("/vendor/**").success).toBe(
      false,
    );

    // Protected paths prohibited from exclusion
    expect(
      repositoryPolicyGlobSchema.safeParse(".github/holon.yml").success,
    ).toBe(false);
    expect(
      repositoryPolicyGlobSchema.safeParse(".github/workflows/**").success,
    ).toBe(false);
    expect(repositoryPolicyGlobSchema.safeParse("SECURITY.md").success).toBe(
      false,
    );
    expect(
      repositoryPolicyGlobSchema.safeParse(".github/CODEOWNERS").success,
    ).toBe(false);
  });

  it("validates repository configuration with strict parsing", () => {
    const minimal = {};
    expect(repositoryConfigInputSchema.parse(minimal)).toEqual(minimal);

    const full = {
      review: {
        additional_excludes: ["fixtures/**", "generated/*.ts"],
      },
      verdict: {
        strictness: "block_all_confident_medium" as const,
      },
    };
    expect(repositoryConfigInputSchema.parse(full)).toEqual(full);

    // Rejects unexpected keys (strictObject)
    expect(
      repositoryConfigInputSchema.safeParse({ ...minimal, extra: true })
        .success,
    ).toBe(false);
    expect(
      repositoryConfigInputSchema.safeParse({
        ...full,
        review: { ...full.review, rules: [] },
      }).success,
    ).toBe(false);

    // Rejects invalid version
    expect(repositoryConfigInputSchema.safeParse({ version: 2 }).success).toBe(
      false,
    );

    // Rejects invalid strictness
    expect(
      repositoryConfigInputSchema.safeParse({
        verdict: { strictness: "invalid" },
      }).success,
    ).toBe(false);
  });

  it("validates canonical repository policy schema", () => {
    const policy = {
      additionalExcludes: ["vendor/**"],
      baseSha: "a".repeat(40),
      effectivePolicyDigest: "b".repeat(64),
      source: ".github/holon.yml" as const,
      sourceDigest: "c".repeat(64),
      verdictStrictness: "block_all_confident_medium" as const,
    };
    expect(repositoryPolicySchema.parse(policy)).toEqual(policy);

    // Source digest can be null for default policy
    const defaultPolicy = {
      ...policy,
      additionalExcludes: [],
      source: "default" as const,
      sourceDigest: null,
      verdictStrictness: "default" as const,
    };
    expect(repositoryPolicySchema.parse(defaultPolicy)).toEqual(defaultPolicy);

    // Invalid SHA formats
    expect(
      repositoryPolicySchema.safeParse({ ...policy, baseSha: "invalid" })
        .success,
    ).toBe(false);
    expect(
      repositoryPolicySchema.safeParse({
        ...policy,
        effectivePolicyDigest: "short",
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

  it("coerces and clamps imperfect LLM outputs in modelReviewTransportSchema", () => {
    const rawImperfection = {
      extraRootField: "unexpected",
      findings: [
        {
          confidence: "0.85",
          diagnostic: "A causal explanation of a verified regression.",
          evidence: [
            {
              endLine: "10", // string number
              excerpt: "e".repeat(350), // preserved under the larger limit
              extraEvidenceField: 123,
              path: "src/file.ts",
              reason: "r".repeat(250), // preserved under the larger limit
              startLine: "5", // string number
            },
            {
              endLine: null,
              excerpt: "second evidence",
              path: "src/file.ts",
              reason: "second reason",
              startLine: 20,
            },
            {
              endLine: null,
              excerpt: "third evidence", // retained under the larger evidence budget
              path: "src/file.ts",
              reason: "third reason",
              startLine: 30,
            },
          ],
          extraFindingField: true,
          location: {
            line: "5", // string number
            path: "src/file.ts",
            side: "RIGHT",
            startLine: "5", // string number
          },
          severity: "HIGH", // uppercase, should be normalized
          suggestion: "   ", // empty whitespace, should become null
        },
      ],
      summary: "s".repeat(2700), // retained under the larger summary budget
    };

    const parsed = modelReviewTransportSchema.parse(rawImperfection);
    expect(parsed.summary.length).toBe(2700);
    expect(parsed.summary).toBe(rawImperfection.summary);
    const firstFinding = parsed.findings[0]!;
    const firstEvidence = firstFinding.evidence[0]!;
    expect(firstFinding.diagnostic.length).toBeGreaterThanOrEqual(30);
    expect(firstFinding.evidence.length).toBe(3);
    expect(firstEvidence.excerpt.length).toBe(350);
    expect(firstEvidence.reason.length).toBe(250);
    expect(firstEvidence.startLine).toBe(5);
    expect(firstEvidence.endLine).toBe(10);
    expect(firstFinding.location.line).toBe(5);
    expect(firstFinding.severity).toBe("high");
    expect(firstFinding.suggestion).toBeNull();
    // Verify extra fields stripped
    expect((parsed as Record<string, unknown>).extraRootField).toBeUndefined();
    expect(
      (firstFinding as Record<string, unknown>).extraFindingField,
    ).toBeUndefined();
  });

  it("keeps the largest valid model result below the Workflow step limit", () => {
    const maximumFinding = {
      confidence: 1,
      diagnostic: "界".repeat(2000),
      evidence: Array.from({ length: 4 }, () => ({
        excerpt: "界".repeat(1200),
        path: "p".repeat(1_024),
        reason: "界".repeat(600),
        startLine: 1,
      })),
      location: { line: 1, path: "p".repeat(1_024), side: "RIGHT" },
      severity: "critical",
      suggestion: "界".repeat(3000),
    };
    const maximumOutput = modelReviewOutputSchema.parse({
      findings: Array.from({ length: 8 }, () => maximumFinding),
      summary: "界".repeat(10000),
    });
    expect(
      new TextEncoder().encode(JSON.stringify(maximumOutput)).byteLength,
    ).toBeLessThan(1_000_000);
  });

  it("parses isDegraded flag when present in model review output", () => {
    const degradedTransport = {
      findings: [],
      isDegraded: true,
      summary: "Degraded analysis fallback text",
    };
    const parsed = parseModelReviewTransport(degradedTransport);
    expect(parsed.isDegraded).toBe(true);
    expect(parsed.summary).toBe("Degraded analysis fallback text");
    expect(parsed.findings).toEqual([]);
  });

  it("validates publication reconciliation data", () => {
    const findingId = `finding:${"c".repeat(64)}`;
    expect(
      publicationRecordSchema.parse({
        findingId,
        githubCommentId: 1234,
        kind: "inline",
        marker: `<!-- holon;run=${encodeURIComponent(runId)};finding=${encodeURIComponent(findingId)} -->`,
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
        marker: `<!-- holon;run=${encodeURIComponent(runId)};finding=${encodeURIComponent(record.findingId)} -->`,
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
  });

  it("validates line coverage, test execution reports, and CI evidence contracts", () => {
    const lineCoverage = {
      hitsByLine: { "10": 3, "11": 0, "12": 1 },
      path: "src/example.ts",
      totalFound: 3,
      totalHit: 2,
    } as const;

    expect(lineCoverageSchema.parse(lineCoverage)).toEqual(lineCoverage);

    const testReport = {
      durationMs: 1250,
      failed: 1,
      failures: [
        {
          filePath: "test/example.test.ts",
          line: 42,
          message: "AssertionError: expected true but got false",
          testName: "it should handle empty input",
        },
      ],
      passed: 10,
      skipped: 0,
      total: 11,
    } as const;

    expect(testExecutionReportSchema.parse(testReport)).toEqual(testReport);

    const fullEvidence = {
      coverage: [lineCoverage],
      source: "github-actions",
      status: "available",
      tests: testReport,
      workflowName: "CI Tests",
      workflowRunId: 12345678,
    } as const;

    expect(ciEvidenceSchema.parse(fullEvidence)).toEqual(fullEvidence);

    const notAvailableEvidence = {
      status: "not_available",
    } as const;

    expect(ciEvidenceSchema.parse(notAvailableEvidence)).toEqual(
      notAvailableEvidence,
    );
  });

  describe("review verdict contracts", () => {
    it("validates reviewVerdictSchema values", () => {
      expect(reviewVerdictSchema.parse("APPROVE")).toBe("APPROVE");
      expect(reviewVerdictSchema.parse("REQUEST_CHANGES")).toBe(
        "REQUEST_CHANGES",
      );
      expect(reviewVerdictSchema.parse("COMMENT")).toBe("COMMENT");
      expect(() => reviewVerdictSchema.parse("DISMISS")).toThrow();
    });

    it("validates reviewVerdictDetailsSchema and policy options", () => {
      const details = {
        advisoryFindingsCount: 2,
        blockingFindingsCount: 1,
        reasons: ["Critical bug found in authentication flow."],
        riskScore: 4.5,
        verdict: "REQUEST_CHANGES" as const,
      };
      expect(reviewVerdictDetailsSchema.parse(details)).toEqual(details);

      const options = {
        allowApprove: true,
        blockingSeverities: ["critical" as const, "high" as const],
        mediumHighConfidenceThreshold: 0.85,
        mediumSeverityThreshold: 2,
        minimumConfidenceThreshold: 0.75,
        riskScoreThreshold: 2.0,
      };
      expect(reviewVerdictPolicyOptionsSchema.parse(options)).toEqual(options);
    });

    it("validates aggregatedReviewResultSchema with verdict and details", () => {
      const aggregated = {
        findings: [],
        omissionReasons: [],
        scopeStatus: "complete" as const,
        shardsAnalyzed: 2,
        summary: "Clean review, no blocking defects.",
        totalShards: 2,
        verdict: "APPROVE" as const,
        verdictDetails: {
          advisoryFindingsCount: 0,
          blockingFindingsCount: 0,
          reasons: ["All files analyzed with complete scope."],
          riskScore: 0,
          verdict: "APPROVE" as const,
        },
      };
      expect(aggregatedReviewResultSchema.parse(aggregated)).toEqual(
        aggregated,
      );
    });
  });

  describe("finding lifecycle schemas", () => {
    const validFingerprint = `fp:${"b".repeat(64)}`;

    it("validates findingFingerprintSchema and findingStatusSchema", () => {
      expect(findingFingerprintSchema.parse(validFingerprint)).toBe(
        validFingerprint,
      );
      expect(() => findingFingerprintSchema.parse("invalid-fp")).toThrow();
      expect(() =>
        findingFingerprintSchema.parse(`fp:${"b".repeat(63)}`),
      ).toThrow();

      for (const status of [
        "new",
        "persistent",
        "resolved",
        "obsolete",
        "reintroduced",
      ] as const) {
        expect(findingStatusSchema.parse(status)).toBe(status);
      }
      expect(() => findingStatusSchema.parse("unknown")).toThrow();
    });

    it("validates trackedFindingSchema", () => {
      const tracked = {
        evidenceFingerprint: validFingerprint.slice(3),
        confidence: 0.95,
        diagnostic: "Security vulnerability in authentication handler.",
        filePath: "src/auth/jwt.ts",
        fingerprint: validFingerprint,
        firstSeenHeadSha: "1".repeat(40),
        firstSeenRunId: `github:1:pr:1:head:${"1".repeat(40)}:base:${"b".repeat(40)}`,
        githubCommentId: 123456,
        lastSeenHeadSha: "2".repeat(40),
        lastSeenRunId: `github:1:pr:1:head:${"2".repeat(40)}:base:${"b".repeat(40)}`,
        line: 42,
        prKey: "github:1:pr:1" as const,
        severity: "critical" as const,
        status: "persistent" as const,
        updatedAt: "2026-09-02T20:00:00.000Z",
      };
      expect(trackedFindingSchema.parse(tracked)).toEqual(tracked);

      expect(() =>
        trackedFindingSchema.parse({
          ...tracked,
          fingerprint: "bad",
        }),
      ).toThrow();
    });

    it("validates reconciliationSummarySchema with dismissedCount", () => {
      const summary = {
        dismissedCount: 1,
        newCount: 1,
        obsoleteCount: 0,
        persistentCount: 2,
        reintroducedCount: 1,
        resolvedCount: 3,
        totalActiveCount: 4,
      };
      expect(reconciliationSummarySchema.parse(summary)).toEqual(summary);
      expect(() =>
        reconciliationSummarySchema.parse({ ...summary, newCount: -1 }),
      ).toThrow();
    });

    it("validates reconciledFindingSchema", () => {
      const reconciled = {
        evidenceFingerprint: validFingerprint.slice(3),
        confidence: 0.95,
        diagnostic: "SQL injection in query builder method.",
        evidence: [
          {
            excerpt: "db.query(rawSql)",
            path: "src/db.ts",
            reason: "Unescaped user input passed to raw SQL",
            startLine: 10,
          },
        ],
        fingerprint: validFingerprint,
        firstSeenHeadSha: "1".repeat(40),
        location: {
          line: 10,
          path: "src/db.ts",
          side: "RIGHT" as const,
        },
        previousCommentId: 98765,
        severity: "high" as const,
        status: "dismissed" as const,
      };
      expect(reconciledFindingSchema.parse(reconciled)).toEqual(reconciled);
    });
  });

  describe("feedback schemas", () => {
    const validFingerprint = `fp:${"a".repeat(64)}`;

    it("validates feedbackLabelSchema", () => {
      expect(feedbackLabelSchema.parse("false_positive")).toBe(
        "false_positive",
      );
      expect(feedbackLabelSchema.parse("helpful")).toBe("helpful");
      expect(feedbackLabelSchema.parse("wrong_severity")).toBe(
        "wrong_severity",
      );
      expect(feedbackLabelSchema.parse("duplicate")).toBe("duplicate");
      expect(feedbackLabelSchema.parse("not_actionable")).toBe(
        "not_actionable",
      );
      expect(feedbackLabelSchema.parse("missed_defect")).toBe("missed_defect");
      expect(feedbackLabelSchema.parse("thread_resolved")).toBe(
        "thread_resolved",
      );
      expect(() => feedbackLabelSchema.parse("invalid_label")).toThrow();
    });

    it("validates findingFeedbackRecordSchema", () => {
      const record = {
        authorLogin: "alice",
        createdAt: "2026-09-02T10:00:00.000Z",
        fingerprint: validFingerprint,
        githubCommentId: 12345,
        label: "false_positive" as const,
        prKey: "github:42:pr:7",
        reason: "Input validated by framework",
      };
      expect(findingFeedbackRecordSchema.parse(record)).toEqual(record);

      expect(() =>
        findingFeedbackRecordSchema.parse({
          ...record,
          prKey: "invalid-pr-key",
        }),
      ).toThrow();
    });

    it("validates parsedFeedbackCommandSchema", () => {
      const command = {
        label: "wrong_severity" as const,
        reason: "Should be low priority",
        targetSeverity: "low" as const,
      };
      expect(parsedFeedbackCommandSchema.parse(command)).toEqual(command);
    });

    it("validates calibrationMetricsSchema", () => {
      const metrics = {
        falsePositiveCount: 2,
        falsePositiveRate: 0.2,
        helpfulCount: 7,
        totalFeedbacks: 10,
        totalReviewedFindings: 20,
        utilityRate: 0.7,
        wrongSeverityCount: 1,
      };
      expect(calibrationMetricsSchema.parse(metrics)).toEqual(metrics);

      expect(() =>
        calibrationMetricsSchema.parse({
          ...metrics,
          falsePositiveRate: 1.5,
        }),
      ).toThrow();
    });
  });

  describe("structural analysis contracts", () => {
    it("validates changedSymbolSchema correctly", () => {
      const symbol = {
        change: "modified" as const,
        isExported: true,
        kind: "function" as const,
        line: 42,
        name: "calculateTotals",
        path: "src/billing.ts",
      };
      expect(changedSymbolSchema.parse(symbol)).toEqual(symbol);

      expect(() =>
        changedSymbolSchema.parse({
          ...symbol,
          kind: "unknown_kind",
        }),
      ).toThrow();
    });

    it("validates downstreamReferenceSchema correctly", () => {
      const ref = {
        callerLine: 88,
        callerPath: "src/checkout.ts",
        excerpt: "const totals = calculateTotals(cart);",
        symbolName: "calculateTotals",
        targetPath: "src/billing.ts",
      };
      expect(downstreamReferenceSchema.parse(ref)).toEqual(ref);
    });

    it("validates contractBreakSignalSchema correctly", () => {
      const signal = {
        description: "Public function calculateTotals removed from exports",
        kind: "exported_symbol_removed" as const,
        line: 12,
        path: "src/billing.ts",
        severity: "critical" as const,
      };
      expect(contractBreakSignalSchema.parse(signal)).toEqual(signal);
    });

    it("validates testGapSignalSchema correctly", () => {
      const gap = {
        expectedTestPathPattern: "test/billing.test.ts",
        reason: "no_test_file_modified" as const,
        sourcePath: "src/billing.ts",
      };
      expect(testGapSignalSchema.parse(gap)).toEqual(gap);
    });

    it("validates securitySurfaceSignalSchema correctly", () => {
      const sec = {
        excerpt: "const token = env.SECRET_KEY;",
        kind: "secret_or_env_access" as const,
        line: 15,
        path: "src/auth.ts",
      };
      expect(securitySurfaceSignalSchema.parse(sec)).toEqual(sec);
    });

    it("validates structuralImpactReportSchema correctly", () => {
      const report = {
        changedSymbols: [
          {
            change: "modified" as const,
            isExported: true,
            kind: "function" as const,
            line: 42,
            name: "calculateTotals",
            path: "src/billing.ts",
          },
        ],
        contractBreaks: [],
        downstreamReferences: [
          {
            callerLine: 88,
            callerPath: "src/checkout.ts",
            excerpt: "const totals = calculateTotals(cart);",
            symbolName: "calculateTotals",
            targetPath: "src/billing.ts",
          },
        ],
        securitySurfaces: [],
        testGaps: [],
        totalDownstreamReferencesCount: 1,
      };
      expect(structuralImpactReportSchema.parse(report)).toEqual(report);
    });

    it("validates expanded languages in searchStructureArgumentsSchema", () => {
      const validCall = {
        arguments: {
          language: "python" as const,
          maxResults: 10,
          pattern: "def $FN($$$ARGS):",
        },
        name: "search_structure" as const,
      };
      expect(repositoryToolCallSchema.parse(validCall)).toEqual(validCall);
    });
  });

  describe("telemetry contracts", () => {
    it("validates health check report schema", () => {
      const report = {
        checks: {
          aiGateway: true,
          database: true,
          executor: true,
        },
        diagnostics: ["All systems operational"],
        status: "ok" as const,
        timestamp: new Date().toISOString(),
        version: "0.1.0",
      };
      expect(healthCheckReportSchema.parse(report)).toEqual(report);
    });
  });
});
