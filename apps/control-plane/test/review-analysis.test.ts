import {
  compileRepositoryConfiguration,
  configurationReference,
} from "@holon/application";
import {
  reviewJobSchema,
  reviewExecutionLimits,
  type ReviewShardContext,
  type ReviewContext,
} from "@holon/contracts";
import { ModelProviderRequestError } from "@holon/model";
import { describe, expect, it, vi } from "vitest";

import { analyzeReview } from "../src/review/review-analysis.js";
import type { ReviewServices } from "../src/review/review-services.js";
import { ThinkReviewFailure } from "../src/review/think-reviewer.js";
import {
  configurationReader,
  defaultRunConfiguration,
} from "./configuration-fixtures.js";
import { toolOperation } from "./executor-fixture.js";
import { unconfiguredExecutor } from "./executor-fixture.js";

const canonicalPatch = [
  "diff --git a/src/index.ts b/src/index.ts",
  "--- a/src/index.ts",
  "+++ b/src/index.ts",
  "@@ -9,0 +10,1 @@",
  "+return null;",
].join("\n");

const job = reviewJobSchema.parse({
  envelope: {
    action: "opened",
    deliveryId: "github:delivery-review-analysis",
    event: "pull_request",
    installationId: 99,
    pullRequest: {
      baseSha: "b".repeat(40),
      headSha: "a".repeat(40),
      number: 7,
      updatedAt: "2026-08-29T12:00:00.000Z",
    },
    receivedAt: "2026-08-29T12:00:01.000Z",
    repository: {
      fullName: "acme/api",
      id: 42,
      name: "api",
      owner: "acme",
    },
  },
  runId: `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}`,
});

// Confidence 0.80 is confident (>= 0.75) but below high-confidence (0.85)
const moderateFinding = {
  confidence: 0.8,
  diagnostic: "Moderate severity observation on modified return statement",
  evidence: [
    {
      excerpt: "return null;",
      path: "src/index.ts",
      reason: "Nullable return",
      startLine: 10,
    },
  ],
  location: { line: 10, path: "src/index.ts", side: "RIGHT" as const },
  severity: "medium" as const,
};

function createMockServices(
  context: ReviewContext | ReviewShardContext,
  modelReview: Awaited<ReturnType<ReviewServices["model"]["review"]>> = {
    output: {
      findings: [moderateFinding],
      summary: "Review summary",
    },
    promptTruncated: false,
  },
): ReviewServices {
  return {
    resolveMemory: () => Promise.reject(new Error("unused")),
    createShardReviewer() {
      return { model: this.model };
    },
    createMutationContext: () => Promise.reject(new Error("unused")),
    createSession: () => Promise.reject(new Error("unused")),
    ensureContext: () => Promise.resolve(false),
    reconcileCheckRun: async () => undefined,
    executor: {
      ...unconfiguredExecutor,
      cleanup: () => Promise.resolve(),
      hasContext: () => Promise.resolve(true),
      startTool: toolOperation(async () => ({ content: "", truncated: false })),
      acquireReviewLease: async () => {},
    },
    ledger: {
      loadRunConfiguration: () => defaultRunConfiguration(job),
      loadPrFindings: () => Promise.resolve([]),
      loadModelGenerationStop: async () => undefined,
      savePrFindings: () => Promise.resolve(),
    } as unknown as ReviewServices["ledger"],
    loadContext: () =>
      Promise.resolve({
        effectivePolicyDigest: "c".repeat(64),
        policySource: "default",
        sourceDigest: null,
        verdictStrictness: "default",
        waiversCount: 0,
        ...context,
      }),
    model: {
      review: () => Promise.resolve(modelReview),
    },
    prepareRepository: () => Promise.reject(new Error("unused")),
    readCurrentHead: () => Promise.resolve("a".repeat(40)),
    readCurrentRefs: () =>
      Promise.resolve({ baseSha: "b".repeat(40), headSha: "a".repeat(40) }),
    registerCredentialScope: () => Promise.resolve(),
    workflow: {
      get: () => Promise.reject(new Error("unused")),
    },
  };
}

describe("analyzeReview", () => {
  it.each(["omitted", "degraded"] as const)(
    "marks incomplete multi-shard review without trusting its narrative (%s)",
    async (reason) => {
      const services = createMockServices(
        {
          changedLines: [],
          files: Array.from(
            { length: reviewExecutionLimits.shardFiles + 1 },
            (_, index) => ({
              mode: "structural" as const,
              path: `src/file-${index}.ts`,
              patch: `@@ -1 +1 @@\n-old\n+new\n`,
            }),
          ),
          truncated: reason === "omitted",
        },
        {
          output: {
            findings: [],
            summary: "Everything looks correct.",
            isDegraded: reason === "degraded",
          },
          promptTruncated: false,
        },
      );
      const result = await analyzeReview(job, services, vi.fn());
      expect(result.totalShards).toBe(2);
      expect(result.summary).toContain("## ⚠️ Holon · Incomplete review");
      expect(result.summary).not.toContain("Everything looks correct");
    },
  );

  it("reports partial coverage when every eligible patch was omitted before planning", async () => {
    const services = createMockServices({
      changedLines: [],
      files: [],
      truncated: true,
    });
    const review = vi.spyOn(services.model, "review");
    const result = await analyzeReview(job, services, vi.fn());
    expect(result.scopeStatus).toBe("partial_by_policy");
    expect(result.verdict).toBe("COMMENT");
    expect(result.summary).toContain("## ⚠️ Holon · Incomplete review");
    expect(result.summary).not.toContain("No eligible changes");
    expect(review).not.toHaveBeenCalled();
  });

  it("applies strictness block_all_confident_medium under complete context to block on a single medium finding", async () => {
    const policyContext: ReviewContext = {
      changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
      effectivePolicyDigest: "c".repeat(64),
      files: [
        { mode: "structural", patch: canonicalPatch, path: "src/index.ts" },
      ],
      policySource: ".github/holon.yml",
      sourceDigest: "d".repeat(64),
      truncated: false,
      verdictStrictness: "block_all_confident_medium",
      waiversCount: 0,
    };

    const emit = vi.fn();
    const services = createMockServices(policyContext);
    const result = await analyzeReview(job, services, emit);

    expect(result.verdict).toBe("REQUEST_CHANGES");
    expect(result.verdictDetails?.verdict).toBe("REQUEST_CHANGES");
    expect(result.policySource).toBe(".github/holon.yml");
    expect(result.waiversCount).toBe(0);
  });

  it("applies default strictness under complete context approving a single moderate finding", async () => {
    const policyContext: ReviewContext = {
      changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
      effectivePolicyDigest: "c".repeat(64),
      files: [
        { mode: "structural", patch: canonicalPatch, path: "src/index.ts" },
      ],
      policySource: "default",
      sourceDigest: null,
      truncated: false,
      verdictStrictness: "default",
      waiversCount: 0,
    };

    const emit = vi.fn();
    const services = createMockServices(policyContext);
    const result = await analyzeReview(job, services, emit);

    expect(result.verdict).toBe("APPROVE");
    expect(result.verdictDetails?.verdict).toBe("APPROVE");
    expect(result.policySource).toBe("default");
    expect(result.waiversCount).toBe(0);
  });

  it("marks partial_by_policy when waiversCount > 0 resulting in COMMENT verdict", async () => {
    const policyContext: ReviewContext = {
      changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
      effectivePolicyDigest: "c".repeat(64),
      files: [
        { mode: "structural", patch: canonicalPatch, path: "src/index.ts" },
      ],
      policySource: ".github/holon.yml",
      sourceDigest: "d".repeat(64),
      truncated: false,
      verdictStrictness: "block_all_confident_medium",
      waiversCount: 2,
    };

    const emit = vi.fn();
    const services = createMockServices(policyContext);
    const modelReview = vi.spyOn(services.model, "review");
    const result = await analyzeReview(job, services, emit);

    expect(result.scopeStatus).toBe("partial_by_policy");
    expect(result.verdict).toBe("COMMENT");
    expect(result.policySource).toBe(".github/holon.yml");
    expect(result.waiversCount).toBe(2);
    expect(modelReview).toHaveBeenCalledOnce();
    expect(result.effectivePolicyDigest).toBe("c".repeat(64));
    expect(result.sourceDigest).toBe("d".repeat(64));
  });

  it("passes the durable policy into context reconstruction", async () => {
    const policyContext: ReviewContext = {
      changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
      effectivePolicyDigest: "c".repeat(64),
      files: [
        { mode: "structural", patch: canonicalPatch, path: "src/index.ts" },
      ],
      policySource: ".github/holon.yml",
      sourceDigest: "d".repeat(64),
      truncated: false,
      verdictStrictness: "default",
      waiversCount: 0,
    };
    const effectivePolicy = {
      additionalExcludes: ["generated/**"],
      baseSha: "b".repeat(40),
      effectivePolicyDigest: "c".repeat(64),
      source: ".github/holon.yml" as const,
      sourceDigest: "d".repeat(64),
      verdictStrictness: "default" as const,
    };
    const services = createMockServices(policyContext);
    const ensureContext = vi.fn(() => Promise.resolve(false));

    await analyzeReview(
      job,
      { ...services, ensureContext },
      vi.fn(),
      effectivePolicy,
    );

    expect(ensureContext).toHaveBeenCalledWith(2, effectivePolicy);
  });

  it("aggregates shard narratives without marking sharding as truncation", async () => {
    const largePatch1 = `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,0 +1,500 @@\n${"+a;\n".repeat(500)}`;
    const largePatch2 = `diff --git a/src/b.ts b/src/b.ts\n--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1,0 +1,500 @@\n${"+b;\n".repeat(500)}`;

    const shardContext: ReviewShardContext = {
      changedLines: [
        { line: 1, path: "src/a.ts", side: "RIGHT" },
        { line: 1, path: "src/b.ts", side: "RIGHT" },
      ],
      files: [
        { mode: "structural", patch: largePatch1, path: "src/a.ts" },
        { mode: "structural", patch: largePatch2, path: "src/b.ts" },
      ],
      truncated: false,
    };

    const emit = vi.fn();
    const services = createMockServices(shardContext, {
      output: { findings: [], summary: "Review summary" },
      promptTruncated: false,
    });
    const result = await analyzeReview(job, services, emit);
    expect(result.policySource).toBe("default");
    expect(result.waiversCount).toBe(0);
    expect(result.verdict).toBe("APPROVE");
    expect(result.summary).toContain("Review summary");
    expect(result.summary).not.toContain("input_context_omitted");
    expect(
      emit.mock.calls.some(([event]) => event === "model.output_limits"),
    ).toBe(false);
  });

  it.each([true, false])(
    "keeps loss diagnostics and structural leads without automatic findings (input omitted=%s)",
    async (inputOmitted) => {
      const context: ReviewShardContext = {
        truncated: inputOmitted,
        files: [
          { mode: "structural", path: "src/index.ts", patch: canonicalPatch },
        ],
        changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
        structuralImpact: {
          changedSymbols: [
            {
              path: "src/index.ts",
              name: "oldExport",
              change: "deleted",
              isExported: true,
              kind: "constant",
              line: 10,
            },
          ],
          contractBreaks: [
            {
              path: "src/index.ts",
              line: 10,
              kind: "exported_symbol_removed",
              severity: "critical",
              description: "Removed export",
            },
          ],
          downstreamReferences: [
            {
              targetPath: "src/index.ts",
              callerPath: "src/consumer.ts",
              callerLine: 1,
              symbolName: "oldExport",
              excerpt: "oldExport",
            },
          ],
          securitySurfaces: [
            {
              path: "src/index.ts",
              line: 10,
              kind: "network_egress",
              excerpt: "return null;",
            },
          ],
          repositoryScanTruncated: true,
        },
      };
      const services = createMockServices(context);
      const review = vi.fn().mockResolvedValue({
        output: {
          findings: [],
          summary: "No consumer regression proven",
          isDegraded: !inputOmitted,
          outputLimitations: inputOmitted ? [] : ["summary_truncated"],
        },
        promptTruncated: inputOmitted,
      });
      services.model.review = review;
      const emit = vi.fn();
      const result = await analyzeReview(job, services, emit);
      expect(result.findings).toHaveLength(0);
      expect(result.verdict).toBe("COMMENT");
      expect(result.summary).toContain(
        inputOmitted ? "input_context_omitted" : "summary_truncated",
      );
      expect(review.mock.calls[0]?.[1]).toMatchObject({
        truncated: false,
        structuralImpact: context.structuralImpact,
      });
      expect(emit).toHaveBeenCalledWith(
        "model.output_limits",
        expect.objectContaining({ inputContextOmitted: inputOmitted }),
      );
      expect(emit).toHaveBeenCalledWith(
        "review.shard_partial",
        expect.objectContaining({
          shardIndex: 0,
          reason: inputOmitted ? "input_context_omitted" : "summary_truncated",
        }),
        expect.any(String),
      );
      expect(emit).toHaveBeenCalledWith(
        "review.analysis_partial",
        expect.objectContaining({
          scopeStatus: inputOmitted ? "partial_by_policy" : "complete",
          degradedShards: 1,
        }),
        undefined,
      );
    },
  );

  it("throws when all review shards fail in a multi-shard review", async () => {
    const largePatch1 = `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,0 +1,250 @@\n${"+a;\n".repeat(250)}`;
    const largePatch2 = `diff --git a/src/b.ts b/src/b.ts\n--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1,0 +1,250 @@\n${"+b;\n".repeat(250)}`;

    const shardContext: ReviewShardContext = {
      changedLines: [
        { line: 1, path: "src/a.ts", side: "RIGHT" },
        { line: 1, path: "src/b.ts", side: "RIGHT" },
      ],
      files: [
        { mode: "structural", patch: largePatch1, path: "src/a.ts" },
        { mode: "structural", patch: largePatch2, path: "src/b.ts" },
      ],
      truncated: false,
    };

    const emit = vi.fn();
    const services = createMockServices(shardContext, {
      output: { findings: [], summary: "Review summary" },
      promptTruncated: false,
    });
    services.model.review = vi
      .fn()
      .mockRejectedValue(new ModelProviderRequestError(true, 504));

    await expect(analyzeReview(job, services, emit)).rejects.toThrow(
      "All review shards failed during model execution",
    );
    expect(emit).toHaveBeenCalledWith(
      "review.shard_failed",
      expect.objectContaining({
        reason: "provider_transient",
        statusCode: 504,
        shardIndex: 0,
      }),
      "0:provider_transient",
    );
  });

  it("converts non-retryable model error to NonRetryableError", async () => {
    const shardContext: ReviewShardContext = {
      changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
      files: [
        { mode: "structural", patch: canonicalPatch, path: "src/index.ts" },
      ],
      truncated: false,
    };

    const emit = vi.fn();
    const services = createMockServices(shardContext, {
      output: { findings: [], summary: "Review summary" },
      promptTruncated: false,
    });
    services.model.review = vi
      .fn()
      .mockRejectedValue(new Error("HOLON_MODEL_NON_RETRYABLE:schema_invalid"));

    await expect(analyzeReview(job, services, emit)).rejects.toThrow(
      "HOLON_MODEL_NON_RETRYABLE:schema_invalid",
    );
  });
});

function revalidationContext(): ReviewShardContext {
  return {
    changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
    files: [
      { mode: "structural", path: "src/index.ts", patch: canonicalPatch },
    ],
    truncated: false,
  };
}

it("rejects invented evidence and refuses an approval when every proposed finding is rejected", async () => {
  const services = createMockServices(revalidationContext());
  services.model.review = vi.fn().mockResolvedValue({
    output: {
      findings: [
        {
          ...moderateFinding,
          evidence: [
            { ...moderateFinding.evidence[0], excerpt: "invented code" },
          ],
        },
      ],
      summary: "Looks good",
    },
    promptTruncated: false,
  });
  const result = await analyzeReview(job, services, () => undefined);
  expect(result.activeFindings).toHaveLength(0);
  expect(result.isDegraded).toBe(true);
  expect(result.verdict).toBe("COMMENT");
});

it.each(["silence", "invented", "low-confidence", "unchanged", "valid"])(
  "requires changed canonical correction evidence for resolution: %s",
  async (mode) => {
    const { computeEvidenceFingerprint } = await import("@holon/domain");
    const fingerprint = `fp:${"f".repeat(64)}` as const;
    const services = createMockServices(revalidationContext());
    services.ledger.loadPrFindings = vi.fn().mockResolvedValue([
      {
        fingerprint,
        evidenceFingerprint: await computeEvidenceFingerprint("src/index.ts", [
          {
            ...moderateFinding.evidence[0]!,
            excerpt:
              mode === "unchanged" ? "return null;" : "return user.name;",
          },
        ]),
        diagnostic: "The property access throws for a null user",
        filePath: "src/index.ts",
        line: 10,
        confidence: 0.95,
        severity: "high",
        status: "new",
        prKey: "github:42:pr:7",
        firstSeenHeadSha: "b".repeat(40),
        lastSeenHeadSha: "b".repeat(40),
        firstSeenRunId: job.runId,
        lastSeenRunId: job.runId,
        updatedAt: "2026-09-08T12:00:00Z",
      },
    ]);
    services.model.review = vi.fn().mockResolvedValue({
      output: {
        findings: [],
        summary: "Review complete",
        resolutions:
          mode === "silence"
            ? []
            : [
                {
                  fingerprint,
                  confidence: mode === "low-confidence" ? 0.8 : 0.95,
                  diagnostic:
                    "The new return no longer dereferences the null user",
                  location: moderateFinding.location,
                  evidence: [
                    {
                      ...moderateFinding.evidence[0],
                      excerpt:
                        mode === "invented"
                          ? "return user?.name;"
                          : "return null;",
                    },
                  ],
                },
              ],
      },
      promptTruncated: false,
    });
    const emit = vi.fn();
    const result = await analyzeReview(job, services, emit);
    if (mode === "invented") {
      expect(emit).toHaveBeenCalledWith(
        "model.evidence_rejected",
        {
          severity: "warning",
          shardIndex: 0,
          candidateKind: "resolution",
          findingIndex: 0,
          evidenceIndex: 0,
          reason: "evidence_excerpt_mismatch",
        },
        "0:resolution:0",
      );
    }
    expect(result.resolvedFindings).toHaveLength(mode === "valid" ? 1 : 0);
    expect(result.verdict).toBe(mode === "valid" ? "APPROVE" : "COMMENT");
  },
);

it("replays completed shard checkpoints without repeating model calls after aggregation interruption", async () => {
  const services = createMockServices(revalidationContext());
  const review = vi.fn().mockResolvedValue({
    output: { findings: [moderateFinding], summary: "Review complete" },
    promptTruncated: false,
  });
  services.model.review = review;
  const cache = new Map<string, unknown>();
  let interrupted = false;
  const execution = {
    configuration: configurationReference(await defaultRunConfiguration(job)),
    async runStep<R>(
      name: string,
      _phase: "preparation" | "analysis",
      fn: () => Promise<R>,
    ): Promise<R> {
      if (cache.has(name)) return cache.get(name) as R;
      if (name === "analyze-review" && !interrupted) {
        interrupted = true;
        throw new Error("simulated process interruption");
      }
      const value = await fn();
      cache.set(name, value);
      return value;
    },
    finish: async (output: import("@holon/contracts").ReconciledReviewOutput) =>
      output,
  };
  await expect(
    analyzeReview(job, services, () => undefined, undefined, execution),
  ).rejects.toThrow("simulated process interruption");
  expect(review).toHaveBeenCalledTimes(1);
  const result = await analyzeReview(
    job,
    services,
    () => undefined,
    undefined,
    execution,
  );
  expect(review).toHaveBeenCalledTimes(1);
  expect(result.activeFindings).toHaveLength(1);
});

it("retries a failed shard without spending another model call on its successful predecessor", async () => {
  const files = ["a", "b"].map((name) => ({
    path: `src/${name}.ts`,
    mode: "structural" as const,
    patch: `diff --git a/src/${name}.ts b/src/${name}.ts\n--- a/src/${name}.ts\n+++ b/src/${name}.ts\n@@ -1,0 +1,500 @@\n${`+${name};\n`.repeat(500)}`,
  }));
  const services = createMockServices({
    files,
    changedLines: files.map((f) => ({
      path: f.path,
      line: 1,
      side: "RIGHT" as const,
    })),
    truncated: false,
  });
  const calls: string[] = [];
  services.model.review = vi.fn(async (_job, context) => {
    const path = context.files[0]!.path;
    calls.push(path);
    if (path === "src/b.ts" && calls.filter((p) => p === path).length === 1)
      throw new Error("transient provider failure");
    return {
      output: { findings: [], summary: "Review complete" },
      promptTruncated: false,
    };
  });
  const result = await analyzeReview(
    job,
    services,
    () => undefined,
    undefined,
    {
      configuration: configurationReference(await defaultRunConfiguration(job)),
      async runStep<R>(
        _name: string,
        _phase: "preparation" | "analysis",
        fn: () => Promise<R>,
      ): Promise<R> {
        try {
          return await fn();
        } catch {
          return await fn();
        }
      },
      finish: async (output) => output,
    },
  );
  expect(calls).toEqual(["src/a.ts", "src/b.ts", "src/b.ts"]);
  expect(result.shardsAnalyzed).toBe(2);
  expect(result.scopeStatus).toBe("complete");
});

it("starts independent shards concurrently and joins them before aggregation", async () => {
  const services = createMockServices({
    changedLines: [],
    truncated: false,
    files: Array.from(
      { length: reviewExecutionLimits.shardFiles + 1 },
      (_, i) => ({
        path: `src/f${i}.ts`,
        mode: "structural" as const,
        patch: "@@ -1 +1 @@\n-old\n+new",
      }),
    ),
  });
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const review = vi.fn(async () => {
    await barrier;
    return {
      output: { findings: [], summary: "Reviewed" },
      promptTruncated: false,
    };
  });
  services.model.review = review;
  const pending = analyzeReview(job, services, vi.fn());
  try {
    await vi.waitFor(() => expect(review).toHaveBeenCalledTimes(2), {
      timeout: 200,
    });
  } finally {
    release();
    await pending;
  }
});
it("never downgrades a ledger failure into a model shard failure", async () => {
  const services = createMockServices({
    changedLines: [],
    truncated: false,
    files: Array.from(
      { length: reviewExecutionLimits.shardFiles + 1 },
      (_, i) => ({
        path: `src/f${i}.ts`,
        mode: "structural" as const,
        patch: "@@ -1 +1 @@\n-old\n+new",
      }),
    ),
  });
  services.ledger.loadPrFindings = vi
    .fn()
    .mockRejectedValueOnce(new Error("ledger unavailable"))
    .mockResolvedValue([]);
  await expect(analyzeReview(job, services, vi.fn())).rejects.toThrow(
    "ledger unavailable",
  );
});
it("preflights later-shard guidance before spending any review inference", async () => {
  const snapshot = await compileRepositoryConfiguration(
    {
      runId: job.runId,
      installationId: job.envelope.installationId,
      repositoryId: 42,
      pullRequestNumber: 7,
      headSha: "a".repeat(40),
      baseSha: "b".repeat(40),
    },
    configurationReader({
      ".holon.yml": JSON.stringify({
        instructions: ["global guidance ".repeat(1000)],
        path_rules: [
          {
            paths: ["src/z-last.ts"],
            instructions: ["specific guidance ".repeat(880)],
          },
        ],
      }),
    }),
    JSON.parse,
  );
  const files = [
    ...Array.from(
      { length: 20 },
      (_, index) => `src/a${index.toString().padStart(2, "0")}.ts`,
    ),
    "src/z-last.ts",
  ].map((path) => ({
    path,
    mode: "structural" as const,
    patch: "@@ -1 +1 @@\n-old\n+new\n",
  }));
  const services = createMockServices({
    changedLines: [],
    files,
    truncated: false,
  });
  services.ledger.loadRunConfiguration = async () => snapshot;
  const review = vi.spyOn(services.model, "review");
  const emit = vi.fn();
  await expect(
    analyzeReview(job, services, emit, undefined, {
      configuration: configurationReference(snapshot),
      runStep: async (_name, _phase, fn) => fn(),
      finish: async (output) => output,
    }),
  ).rejects.toMatchObject({
    name: "NonRetryableError",
    message: "HOLON_REPOSITORY_CONFIG:budget_exceeded",
  });
  expect(emit).toHaveBeenCalledWith(
    "configuration.guidance_applied",
    expect.objectContaining({ shardIndex: 0 }),
  );
  expect(review).not.toHaveBeenCalled();
});

it("logs the exact rejection reason without leaking candidate content", async () => {
  const context: ReviewShardContext = {
    changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
    files: [
      { path: "src/index.ts", patch: canonicalPatch, mode: "structural" },
    ],
    truncated: false,
  };
  const services = createMockServices(context, {
    output: {
      summary: "PRIVATE summary",
      findings: [
        {
          ...moderateFinding,
          evidence: [
            {
              ...moderateFinding.evidence[0]!,
              excerpt: "PRIVATE invented excerpt",
            },
          ],
        },
      ],
    },
    promptTruncated: false,
  });
  const emit = vi.fn();
  const result = await analyzeReview(job, services, emit);
  expect(result.findings).toHaveLength(0);
  expect(result.verdict).toBe("COMMENT");
  expect(result.summary).toContain("evidence_rejected");
  expect(emit).toHaveBeenCalledWith(
    "model.evidence_rejected",
    {
      severity: "warning",
      shardIndex: 0,
      candidateKind: "finding",
      findingIndex: 0,
      evidenceIndex: 0,
      reason: "evidence_excerpt_mismatch",
    },
    "0:finding:0",
  );
  const rejections = emit.mock.calls.filter(
    ([event]) => event === "model.evidence_rejected",
  );
  expect(JSON.stringify(rejections)).not.toMatch(
    /PRIVATE|src\/index.ts|return null/u,
  );
});

it("keeps evidence rejection semantics when the diagnostic sink fails", async () => {
  const services = createMockServices(revalidationContext(), {
    output: {
      summary: "Review",
      findings: [
        {
          ...moderateFinding,
          evidence: [{ ...moderateFinding.evidence[0]!, excerpt: "invented" }],
        },
      ],
    },
    promptTruncated: false,
  });
  const result = await analyzeReview(job, services, (event) => {
    if (event === "model.evidence_rejected")
      throw new Error("sink unavailable");
  });
  expect(result.findings).toHaveLength(0);
  expect(result.verdict).toBe("COMMENT");
  expect(result.summary).toContain("evidence_rejected");
});

it("publishes an incomplete result when the shared deadline expires before inference", async () => {
  const services = createMockServices({
    files: [
      { mode: "structural", path: "src/index.ts", patch: canonicalPatch },
    ],
    changedLines: [{ path: "src/index.ts", line: 10, side: "RIGHT" }],
    truncated: false,
  });
  const review = vi.spyOn(services.model, "review");
  const emit = vi.fn();
  const result = await analyzeReview(job, services, emit, undefined, {
    configuration: configurationReference(await defaultRunConfiguration(job)),
    async runStep<R>(
      name: string,
      _phase: "analysis" | "preparation",
      fn: () => Promise<R>,
    ): Promise<R> {
      const stepResult = await fn();
      if (name === "plan-review")
        Object.assign(stepResult as object, { deadlineAt: 0 });
      return stepResult;
    },
    finish: async (output) => output,
  });
  expect(review).not.toHaveBeenCalled();
  expect(result.scopeStatus).toBe("partial_by_failure");
  expect(result.verdict).toBe("COMMENT");
  expect(result.summary).toContain("analysis_deadline");
  expect(emit).toHaveBeenCalledWith(
    "review.shard_failed",
    expect.objectContaining({
      shardIndex: 0,
      reason: "analysis_deadline",
      severity: "error",
    }),
    "0:analysis_deadline",
  );
});

it("runs more than one wave of shards with bounded concurrency", async () => {
  const services = createMockServices({
    changedLines: [],
    truncated: true,
    files: Array.from(
      { length: reviewExecutionLimits.shardFiles * 6 + 1 },
      (_, i) => ({
        path: `src/wave${i}.ts`,
        mode: "structural" as const,
        patch: "@@ -1 +1 @@\n-old\n+new",
      }),
    ),
  });
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let active = 0,
    peak = 0;
  const review = vi.fn(async (_job, context) => {
    expect(context.truncated).toBe(false);
    active++;
    peak = Math.max(peak, active);
    if (review.mock.calls.length <= reviewExecutionLimits.concurrency)
      await barrier;
    active--;
    return {
      output: { findings: [], summary: "Reviewed" },
      promptTruncated: false,
    };
  });
  services.model.review = review;
  const pending = analyzeReview(job, services, vi.fn());
  try {
    await vi.waitFor(() =>
      expect(review).toHaveBeenCalledTimes(reviewExecutionLimits.concurrency),
    );
  } finally {
    release();
  }
  const result = await pending;
  expect(review).toHaveBeenCalledTimes(7);
  expect(peak).toBe(reviewExecutionLimits.concurrency);
  expect(result.scopeStatus).toBe("partial_by_policy");
  expect(result.summary).not.toContain("input_context_omitted");
});

it("replays a completed first wave and successful peers without repeating their model calls", async () => {
  const services = createMockServices({
    changedLines: [],
    truncated: false,
    files: Array.from(
      { length: reviewExecutionLimits.shardFiles * 6 + 1 },
      (_, i) => ({
        path: `src/file${String(i).padStart(2, "0")}.ts`,
        mode: "structural" as const,
        patch: "@@ -1 +1 @@\n-old\n+new",
      }),
    ),
  });
  const calls = new Map<string, number>();
  services.model.review = vi.fn(async (_job, context) => {
    const key = context.files[0]!.path;
    calls.set(key, (calls.get(key) ?? 0) + 1);
    if (
      key === `src/file${reviewExecutionLimits.shardFiles * 5}.ts` &&
      calls.get(key) === 1
    )
      throw new Error("temporary ledger dependency failure");
    return {
      output: { findings: [], summary: "Checked" },
      promptTruncated: false,
    };
  });
  const cache = new Map<string, unknown>();
  const execution = {
    configuration: configurationReference(await defaultRunConfiguration(job)),
    async runStep<R>(
      name: string,
      _phase: "analysis" | "preparation",
      fn: () => Promise<R>,
    ): Promise<R> {
      if (cache.has(name)) return cache.get(name) as R;
      const result = await fn();
      cache.set(name, result);
      return result;
    },
    finish: async (output: import("@holon/contracts").ReconciledReviewOutput) =>
      output,
  };
  await expect(
    analyzeReview(job, services, () => {}, undefined, execution),
  ).rejects.toThrow("temporary ledger dependency failure");
  const firstWave = cache.get("analysis-wave-1");
  const result = await analyzeReview(
    job,
    services,
    () => {},
    undefined,
    execution,
  );
  expect(result.totalShards).toBe(7);
  expect(cache.get("analysis-wave-1")).toBe(firstWave);
  expect([...calls.values()].reduce((a, b) => a + b, 0)).toBe(8);
  expect(calls.get(`src/file${reviewExecutionLimits.shardFiles * 5}.ts`)).toBe(
    2,
  );
  expect(calls.get(`src/file${reviewExecutionLimits.shardFiles * 6}.ts`)).toBe(
    1,
  );
});

it("cancels a wave on infrastructure loss, joins cancellation, and never starts the next wave", async () => {
  const services = createMockServices({
    changedLines: [],
    truncated: false,
    files: Array.from(
      { length: reviewExecutionLimits.shardFiles * 6 },
      (_, i) => ({
        path: `src/f${String(i).padStart(3, "0")}.ts`,
        mode: "structural" as const,
        patch: "@@ -1 +1 @@\n-old\n+new",
      }),
    ),
  });
  const failure = new Error("repository unavailable");
  let started = 0;
  let joined = 0;
  let release!: () => void;
  const allStarted = new Promise<void>((resolve) => {
    release = resolve;
  });
  services.createShardReviewer = (index, _total, cancellation) => ({
    model: {
      review: async () => {
        started++;
        if (started === reviewExecutionLimits.concurrency) release();
        await allStarted;
        if (index === 0) {
          cancellation!.abort(failure);
          throw failure;
        }
        cancellation!.signal.throwIfAborted();
        throw new Error("unreachable");
      },
    },
  });
  const original = services.createShardReviewer.bind(services);
  services.createShardReviewer = (...args) => {
    const reviewer = original(...args);
    const review = reviewer.model.review.bind(reviewer.model);
    reviewer.model.review = async (...params) => {
      try {
        return await review(...params);
      } finally {
        await Promise.resolve();
        joined++;
      }
    };
    return reviewer;
  };
  await expect(analyzeReview(job, services, vi.fn())).rejects.toBe(failure);
  expect(started).toBe(reviewExecutionLimits.concurrency);
  expect(joined).toBe(started);
});

it("shares wave preparation with a delayed shard instead of rebuilding while a peer investigates", async () => {
  const services = createMockServices({
    changedLines: [],
    truncated: false,
    files: Array.from(
      { length: reviewExecutionLimits.shardFiles + 1 },
      (_, i) => ({
        path: `src/shared${i}.ts`,
        mode: "structural" as const,
        patch: "@@ -1 +1 @@\n-old\n+new",
      }),
    ),
  });
  let active = 0;
  let notifyFirst!: () => void;
  let notifySecond!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    notifyFirst = resolve;
  });
  const secondStarted = new Promise<void>((resolve) => {
    notifySecond = resolve;
  });
  const prepare = vi.fn(async () => {
    expect(active).toBe(0);
    return false;
  });
  services.ensureContext = prepare;
  services.model.review = async () => {
    active++;
    if (active === 1) {
      notifyFirst();
      await secondStarted;
    } else notifySecond();
    active--;
    return {
      output: { findings: [], summary: "Checked" },
      promptTruncated: false,
    };
  };
  const result = await analyzeReview(job, services, vi.fn(), undefined, {
    configuration: configurationReference(await defaultRunConfiguration(job)),
    runStep: async (name, _phase, fn) => {
      if (name === "analyze-shard-2") await firstStarted;
      return fn();
    },
    finish: async (output) => output,
  });
  expect(result.totalShards).toBe(2);
  expect(prepare).toHaveBeenCalledTimes(3);
});

it("admits investigation discoveries only with canonical changed-line evidence", async () => {
  const context = {
    changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" as const }],
    files: [
      {
        mode: "structural" as const,
        patch: canonicalPatch,
        path: "src/index.ts",
      },
    ],
    truncated: false,
  };
  const services = createMockServices(context, {
    output: {
      findings: [],
      summary: "Review complete",
      investigations: [
        {
          path: "src/index.ts",
          line: 10,
          excerpt: "return null;",
          summary:
            "This branch returns before invoking the downstream consumer.",
        },
        {
          path: "src/index.ts",
          line: 10,
          excerpt: "invented();",
          summary:
            "An invented observation must never enter repository memory.",
        },
      ],
    },
    promptTruncated: false,
  });
  const result = await analyzeReview(job, services, () => {});
  expect(result.investigations).toEqual([
    {
      path: "src/index.ts",
      line: 10,
      excerpt: "return null;",
      summary: "This branch returns before invoking the downstream consumer.",
    },
  ]);
});

it("reviews fifty shards within one full-context transfer budget", async () => {
  const services = createMockServices(
    {
      changedLines: [],
      truncated: false,
      files: Array.from({ length: 50 }, (_, index) => ({
        path: `src/large-${index}.ts`,
        mode: "structural" as const,
        patch: `@@ -0,0 +1,600 @@\n${"+export const value = 1;\n".repeat(600)}`,
      })),
    },
    { output: { findings: [], summary: "Checked" }, promptTruncated: false },
  );
  const original = services.loadContext.bind(services);
  let transfers = 0;
  services.loadContext = async (...args) => {
    if (++transfers > 1)
      throw new Error("Full-context transfer budget exceeded");
    return original(...args);
  };
  const result = await analyzeReview(job, services, vi.fn());
  expect(result.totalShards).toBe(50);
  expect(result.shardsAnalyzed).toBe(50);
  expect(result.verdict).toBe("APPROVE");
  expect(transfers).toBe(1);
});

it.each([false, true])(
  "reloads a reconstructed context and rejects a changed plan: %s",
  async (changed) => {
    const services = createMockServices(revalidationContext());
    const original = services.loadContext.bind(services);
    let reads = 0;
    services.loadContext = async (...args) => {
      const context = await original(...args);
      reads++;
      return changed && reads > 1 ? { ...context, files: [] } : context;
    };
    let preparations = 0;
    services.ensureContext = async () => ++preparations === 2;
    const review = vi.spyOn(services.model, "review");
    if (changed) {
      await expect(analyzeReview(job, services, vi.fn())).rejects.toThrow(
        "Review plan changed during replay",
      );
      expect(review).not.toHaveBeenCalled();
    } else {
      expect((await analyzeReview(job, services, vi.fn())).shardsAnalyzed).toBe(
        1,
      );
      expect(review).toHaveBeenCalledOnce();
    }
    expect(reads).toBe(2);
  },
);

it("stops new waves after durable budget denial, joins peers and preserves findings on replay", async () => {
  const services = createMockServices({
    ...revalidationContext(),
    files: [
      {
        mode: "structural",
        path: "src/index.ts",
        patch: `@@ -9,0 +10,600 @@\n+return null;\n${"+// context\n".repeat(599)}`,
      },
      ...Array.from({ length: 6 }, (_, i) => ({
        mode: "structural" as const,
        path: `src/z-budget-${i}.ts`,
        patch: `@@ -0,0 +1,600 @@\n${"+// context\n".repeat(600)}`,
      })),
    ],
  });
  let stopped = false;
  let active = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  Object.assign(services.ledger, {
    loadModelGenerationStop: async () => (stopped ? "input_bytes" : undefined),
  });
  const review = vi.fn(async (_job, context) => {
    active++;
    try {
      if (context.files[0].path === "src/index.ts")
        return {
          output: { findings: [moderateFinding], summary: "Checked" },
          promptTruncated: false,
        };
      stopped = true;
      await barrier;
      throw new ThinkReviewFailure("agent_workflow_failed");
    } finally {
      active--;
    }
  });
  services.model.review = review;
  const cache = new Map<string, unknown>();
  let interrupted = false;
  const execution = {
    configuration: configurationReference(await defaultRunConfiguration(job)),
    async runStep<R>(
      name: string,
      _phase: "preparation" | "analysis",
      fn: () => Promise<R>,
    ): Promise<R> {
      if (cache.has(name)) return cache.get(name) as R;
      if (name === "analyze-review" && !interrupted) {
        expect(active).toBe(0);
        interrupted = true;
        throw new Error("aggregation interrupted");
      }
      const value = await fn();
      cache.set(name, value);
      return value;
    },
    finish: async (output: import("@holon/contracts").ReconciledReviewOutput) =>
      output,
  };
  const emit = vi.fn();
  const pending = analyzeReview(job, services, emit, undefined, execution).then(
    () => undefined,
    (error: unknown) => error,
  );
  try {
    await vi.waitFor(() => expect(review).toHaveBeenCalledTimes(3));
  } finally {
    release();
  }
  expect(await pending).toMatchObject({ message: "aggregation interrupted" });
  const result = await analyzeReview(job, services, emit, undefined, execution);
  expect(review).toHaveBeenCalledTimes(3);
  expect(result.totalShards).toBe(7);
  expect(result.shardsAnalyzed).toBe(1);
  expect(result.scopeStatus).toBe("partial_by_failure");
  expect(result.verdict).toBe("COMMENT");
  expect(result.activeFindings).toHaveLength(1);
  expect(result.resolvedFindings).toEqual([]);
  expect(emit).toHaveBeenCalledWith(
    "review.analysis_budget_stopped",
    { severity: "warning", rule: "input_bytes", unstartedShards: 4 },
    undefined,
  );
});

it("publishes zero coverage when the only wave exhausts the budget", async () => {
  const services = createMockServices(revalidationContext());
  let stopped = false;
  Object.assign(services.ledger, {
    loadModelGenerationStop: async () => (stopped ? "calls" : undefined),
  });
  services.model.review = vi.fn(async () => {
    stopped = true;
    throw new ThinkReviewFailure("agent_workflow_failed");
  });
  const output = await analyzeReview(job, services, vi.fn());
  expect(output.shardsAnalyzed).toBe(0);
  expect(output.totalShards).toBe(1);
  expect(output.scopeStatus).toBe("partial_by_failure");
  expect(output.verdict).toBe("COMMENT");
  expect(output.activeFindings).toEqual([]);
  expect(output.resolvedFindings).toEqual([]);
  expect(output.summary).toContain(
    "Review model budget exhausted (inference calls).",
  );
});

it("does not publish a partial review when the budget-stop ledger query fails", async () => {
  const services = createMockServices(revalidationContext());
  Object.assign(services.ledger, {
    loadModelGenerationStop: async () => {
      throw new Error("ledger unavailable");
    },
  });
  const review = vi.spyOn(services.model, "review");
  await expect(analyzeReview(job, services, vi.fn())).rejects.toThrow(
    "ledger unavailable",
  );
  expect(review).not.toHaveBeenCalled();
});

it("reloads and validates the plan after invocation replay without repeating completed shards", async () => {
  const services = createMockServices(revalidationContext());
  const cache = new Map<string, unknown>();
  let changed = false;
  const original = services.loadContext.bind(services);
  const load = vi.fn(
    async (...args: Parameters<typeof services.loadContext>) => {
      const context = await original(...args);
      return changed ? { ...context, files: [] } : context;
    },
  );
  services.loadContext = load;
  const review = vi.spyOn(services.model, "review");
  const execution = {
    configuration: configurationReference(await defaultRunConfiguration(job)),
    async runStep<R>(
      name: string,
      _phase: "analysis" | "preparation",
      fn: () => Promise<R>,
    ): Promise<R> {
      if (cache.has(name)) return cache.get(name) as R;
      if (name === "analyze-review") changed = true;
      const value = await fn();
      cache.set(name, value);
      return value;
    },
    finish: async (output: import("@holon/contracts").ReconciledReviewOutput) =>
      output,
  };
  // First invocation has a validated snapshot, so the simulated change is only
  // observable when a new invocation loads canonical context again.
  await analyzeReview(job, services, vi.fn(), undefined, execution);
  cache.delete("analyze-review");
  await expect(
    analyzeReview(job, services, vi.fn(), undefined, execution),
  ).rejects.toThrow("Review plan changed during replay");
  expect(load).toHaveBeenCalledTimes(2);
  expect(review).toHaveBeenCalledOnce();
});
