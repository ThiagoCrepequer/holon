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
    loadContext: () => Promise.resolve(context),
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

  it("handles synthesizeReviewSummary failure gracefully when reviewing multiple shards", async () => {
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
    const services = createMockServices(v2Context);
    (
      services.model as unknown as {
        synthesizeReviewSummary?: () => Promise<string>;
      }
    ).synthesizeReviewSummary = vi
      .fn()
      .mockRejectedValue(new Error("Synthesis failed"));

    const result = await analyzeReview(job, services, emit);
    expect(result.policySource).toBeUndefined();
    expect(result.waiversCount).toBeUndefined();
    expect(result.verdict).toBe("APPROVE");
  });

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
    const services = createMockServices(v2Context);
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
    const services = createMockServices(v2Context);
    services.model.review = vi
      .fn()
      .mockRejectedValue(new Error("HOLON_MODEL_NON_RETRYABLE:schema_invalid"));

    await expect(analyzeReview(job, services, emit)).rejects.toThrow(
      "HOLON_MODEL_NON_RETRYABLE:schema_invalid",
    );
  });
});
