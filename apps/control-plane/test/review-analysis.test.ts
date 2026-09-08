import {
  reviewJobV2Schema,
  type ReviewContextV2,
  type ReviewContextV3,
} from "@holon/contracts";
import { describe, expect, it, vi } from "vitest";

import { analyzeReview } from "../src/review-analysis.js";
import type { ReviewServices } from "../src/review-services.js";

const canonicalPatch = [
  "diff --git a/src/index.ts b/src/index.ts",
  "--- a/src/index.ts",
  "+++ b/src/index.ts",
  "@@ -9,0 +10,1 @@",
  "+return null;",
].join("\n");

const job = reviewJobV2Schema.parse({
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
    schemaVersion: 2,
  },
  runId: `github:42:pr:7:head:${"a".repeat(40)}`,
  schemaVersion: 2,
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
  context: ReviewContextV3 | ReviewContextV2,
  modelReview = {
    output: {
      findings: [moderateFinding],
      summary: "Review summary",
    },
    promptTruncated: false,
  },
): ReviewServices {
  return {
    createMutationContext: () => Promise.reject(new Error("unused")),
    createSession: () => Promise.reject(new Error("unused")),
    ensureContext: () => Promise.resolve(),
    executor: {
      cleanup: () => Promise.resolve(),
      hasContext: () => Promise.resolve(true),
      runTool: () => Promise.resolve({ content: "", truncated: false }),
    },
    getAccumulatedUsage: () => ({
      inputTokens: 10,
      outputTokens: 10,
      toolCallsCount: 1,
    }),
    ledger: {
      loadPrFindings: () => Promise.resolve([]),
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
        schemaVersion: 3,
      }),
    model: {
      review: () => Promise.resolve(modelReview),
    },
    prepareRepository: () => Promise.reject(new Error("unused")),
    readCurrentHead: () => Promise.resolve("a".repeat(40)),
    readCurrentRefs: () =>
      Promise.resolve({ baseSha: "b".repeat(40), headSha: "a".repeat(40) }),
    registerCredentialScope: () => Promise.resolve(),
    telemetry: {
      emit: () => undefined,
    } as unknown as ReviewServices["telemetry"],
    workflow: {
      get: () => Promise.reject(new Error("unused")),
    },
  };
}

describe("analyzeReview", () => {
  it("applies strictness block_all_confident_medium under V3 context to block on a single medium finding", async () => {
    const v3Context: ReviewContextV3 = {
      changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
      effectivePolicyDigest: "c".repeat(64),
      files: [
        { mode: "structural", patch: canonicalPatch, path: "src/index.ts" },
      ],
      policySource: ".github/holon.yml",
      schemaVersion: 3,
      sourceDigest: "d".repeat(64),
      truncated: false,
      verdictStrictness: "block_all_confident_medium",
      waiversCount: 0,
    };

    const emit = vi.fn();
    const services = createMockServices(v3Context);
    const result = await analyzeReview(job, services, emit);

    expect(result.verdict).toBe("REQUEST_CHANGES");
    expect(result.verdictDetails?.verdict).toBe("REQUEST_CHANGES");
    expect(result.policySource).toBe(".github/holon.yml");
    expect(result.waiversCount).toBe(0);
  });

  it("applies default strictness under V3 context approving a single moderate finding", async () => {
    const v3Context: ReviewContextV3 = {
      changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
      effectivePolicyDigest: "c".repeat(64),
      files: [
        { mode: "structural", patch: canonicalPatch, path: "src/index.ts" },
      ],
      policySource: "default",
      schemaVersion: 3,
      sourceDigest: null,
      truncated: false,
      verdictStrictness: "default",
      waiversCount: 0,
    };

    const emit = vi.fn();
    const services = createMockServices(v3Context);
    const result = await analyzeReview(job, services, emit);

    expect(result.verdict).toBe("APPROVE");
    expect(result.verdictDetails?.verdict).toBe("APPROVE");
    expect(result.policySource).toBe("default");
    expect(result.waiversCount).toBe(0);
  });

  it("marks partial_by_policy when waiversCount > 0 resulting in COMMENT verdict", async () => {
    const v3Context: ReviewContextV3 = {
      changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
      effectivePolicyDigest: "c".repeat(64),
      files: [
        { mode: "structural", patch: canonicalPatch, path: "src/index.ts" },
      ],
      policySource: ".github/holon.yml",
      schemaVersion: 3,
      sourceDigest: "d".repeat(64),
      truncated: false,
      verdictStrictness: "block_all_confident_medium",
      waiversCount: 2,
    };

    const emit = vi.fn();
    const services = createMockServices(v3Context);
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
    const v3Context: ReviewContextV3 = {
      changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
      effectivePolicyDigest: "c".repeat(64),
      files: [
        { mode: "structural", patch: canonicalPatch, path: "src/index.ts" },
      ],
      policySource: ".github/holon.yml",
      schemaVersion: 3,
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
      version: 1 as const,
    };
    const services = createMockServices(v3Context);
    const ensureContext = vi.fn(() => Promise.resolve());

    await analyzeReview(
      job,
      { ...services, ensureContext },
      vi.fn(),
      effectivePolicy,
    );

    expect(ensureContext).toHaveBeenCalledWith(2, effectivePolicy);
  });

  it.each([true, false])(
    "publishes synthesis or a safe fallback without marking sharding as truncation (failure=%s)",
    async (failure) => {
      const largePatch1 = `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,0 +1,1600 @@\n${"+a;\n".repeat(1600)}`;
      const largePatch2 = `diff --git a/src/b.ts b/src/b.ts\n--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1,0 +1,1600 @@\n${"+b;\n".repeat(1600)}`;

      const v2Context: ReviewContextV2 = {
        changedLines: [
          { line: 1, path: "src/a.ts", side: "RIGHT" },
          { line: 1, path: "src/b.ts", side: "RIGHT" },
        ],
        files: [
          { mode: "structural", patch: largePatch1, path: "src/a.ts" },
          { mode: "structural", patch: largePatch2, path: "src/b.ts" },
        ],
        schemaVersion: 2,
        truncated: false,
      };

      const emit = vi.fn();
      const services = createMockServices(v2Context, {
        output: { findings: [], summary: "Review summary" },
        promptTruncated: false,
      });
      (
        services.model as unknown as {
          synthesizeReviewSummary?: () => Promise<string>;
        }
      ).synthesizeReviewSummary = failure
        ? vi.fn().mockRejectedValue(new Error("Synthesis failed"))
        : vi.fn().mockResolvedValue("Authoritative unified summary.");

      const result = await analyzeReview(job, services, emit);
      expect(result.policySource).toBe("default");
      expect(result.waiversCount).toBe(0);
      expect(result.verdict).toBe("APPROVE");
      if (!failure)
        expect(result.summary).toContain("Authoritative unified summary.");
      expect(result.summary).not.toContain("input_context_omitted");
      expect(
        emit.mock.calls.some(([event]) => event === "model.output_limits"),
      ).toBe(false);
    },
  );

  it.each([true, false])(
    "keeps loss diagnostics and structural leads without automatic findings (input omitted=%s)",
    async (inputOmitted) => {
      const context: ReviewContextV2 = {
        schemaVersion: 2,
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
          testGaps: [
            {
              sourcePath: "src/index.ts",
              reason: "no_test_file_modified",
              expectedTestPathPattern: "*.test.ts",
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
        truncated: inputOmitted,
        structuralImpact: context.structuralImpact,
      });
      expect(emit).toHaveBeenCalledWith(
        "model.output_limits",
        expect.objectContaining({ inputContextOmitted: inputOmitted }),
      );
    },
  );

  it("throws when all review shards fail in a multi-shard review", async () => {
    const largePatch1 = `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,0 +1,1600 @@\n${"+a;\n".repeat(1600)}`;
    const largePatch2 = `diff --git a/src/b.ts b/src/b.ts\n--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1,0 +1,1600 @@\n${"+b;\n".repeat(1600)}`;

    const v2Context: ReviewContextV2 = {
      changedLines: [
        { line: 1, path: "src/a.ts", side: "RIGHT" },
        { line: 1, path: "src/b.ts", side: "RIGHT" },
      ],
      files: [
        { mode: "structural", patch: largePatch1, path: "src/a.ts" },
        { mode: "structural", patch: largePatch2, path: "src/b.ts" },
      ],
      schemaVersion: 2,
      truncated: false,
    };

    const emit = vi.fn();
    const services = createMockServices(v2Context, {
      output: { findings: [], summary: "Review summary" },
      promptTruncated: false,
    });
    services.model.review = vi
      .fn()
      .mockRejectedValue(new Error("Model timeout"));

    await expect(analyzeReview(job, services, emit)).rejects.toThrow(
      "All review shards failed during model execution",
    );
  });

  it("converts non-retryable model error to NonRetryableError", async () => {
    const v2Context: ReviewContextV2 = {
      changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
      files: [
        { mode: "structural", patch: canonicalPatch, path: "src/index.ts" },
      ],
      schemaVersion: 2,
      truncated: false,
    };

    const emit = vi.fn();
    const services = createMockServices(v2Context, {
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

function revalidationContext(): ReviewContextV2 {
  return {
    schemaVersion: 2,
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
    const result = await analyzeReview(job, services, () => undefined);
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
    patch: `diff --git a/src/${name}.ts b/src/${name}.ts\n--- a/src/${name}.ts\n+++ b/src/${name}.ts\n@@ -1,0 +1,1600 @@\n${`+${name};\n`.repeat(1600)}`,
  }));
  const services = createMockServices({
    schemaVersion: 2,
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
