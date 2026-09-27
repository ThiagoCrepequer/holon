import { zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import {
  enrichReviewWithCiEvidence,
  type CiEnrichmentDependencies,
} from "../src/ci-enrichment-service.js";

const fakeEnv = {
  GITHUB_APP_ID: "12345",
  GITHUB_APP_PRIVATE_KEY_CURRENT: "fake-key",
  GITHUB_APP_SLUG: "holon-reviewer",
} as unknown as Cloudflare.Env;

const baseInput = {
  deliveryId: "deliv-1",
  headSha: "a".repeat(40),
  installationId: 99,
  pullRequestNumber: 7,
  repository: {
    id: 42,
    name: "api",
    owner: "acme",
  },
  workflowName: "CI Gate",
  workflowRunId: 789,
  workflowRunAttempt: 1,
};

describe("CI Enrichment Service", () => {
  it("propagates credential failures for queue retry", async () => {
    const invalidEnv = {
      ...fakeEnv,
      GITHUB_APP_ID: "invalid",
    };
    await expect(
      enrichReviewWithCiEvidence(invalidEnv, baseInput),
    ).rejects.toThrow();
  });

  it("returns unsupported_session when session lacks artifact methods", async () => {
    const deps: CiEnrichmentDependencies = {
      ledger: {
        loadCiEvidence: vi.fn(),
        saveCiEvidence: vi.fn(),
        loadLatestReviewDecision: vi.fn().mockResolvedValue({
          runId: `github:42:pr:7:head:${baseInput.headSha}:base:${"b".repeat(40)}`,
          output: { language: "en", detail: "concise", maxInlineComments: 40 },
        }),
      },
      createSession: vi.fn().mockResolvedValue({
        api: {},
        currentPullRequestRefs: vi.fn().mockResolvedValue({
          headSha: baseInput.headSha,
          baseSha: "b".repeat(40),
        }),
        expectedAuthorLogin: "holon-reviewer[bot]",
      }),
    };

    const result = await enrichReviewWithCiEvidence(fakeEnv, baseInput, deps);
    expect(result).toEqual({ enriched: false, reason: "unsupported_session" });
  });

  it("returns no_artifacts when workflow run has no artifacts", async () => {
    const deps: CiEnrichmentDependencies = {
      ledger: {
        loadCiEvidence: vi.fn(),
        saveCiEvidence: vi.fn(),
        loadLatestReviewDecision: vi.fn().mockResolvedValue({
          runId: `github:42:pr:7:head:${baseInput.headSha}:base:${"b".repeat(40)}`,
          output: { language: "en", detail: "concise", maxInlineComments: 40 },
        }),
      },
      createSession: vi.fn().mockResolvedValue({
        api: {},
        currentPullRequestRefs: vi.fn().mockResolvedValue({
          headSha: baseInput.headSha,
          baseSha: "b".repeat(40),
        }),
        downloadArtifactZip: vi.fn(),
        expectedAuthorLogin: "holon-reviewer[bot]",
        listWorkflowRunArtifacts: vi.fn().mockResolvedValue([]),
      }),
    };

    const result = await enrichReviewWithCiEvidence(fakeEnv, baseInput, deps);
    expect(result).toEqual({ enriched: false, reason: "no_artifacts" });
  });

  it("handles download failure gracefully", async () => {
    const deps: CiEnrichmentDependencies = {
      ledger: {
        loadCiEvidence: vi.fn(),
        saveCiEvidence: vi.fn(),
        loadLatestReviewDecision: vi.fn().mockResolvedValue({
          runId: `github:42:pr:7:head:${baseInput.headSha}:base:${"b".repeat(40)}`,
          output: { language: "en", detail: "concise", maxInlineComments: 40 },
        }),
      },
      createSession: vi.fn().mockResolvedValue({
        api: {},
        currentPullRequestRefs: vi.fn().mockResolvedValue({
          headSha: baseInput.headSha,
          baseSha: "b".repeat(40),
        }),
        downloadArtifactZip: vi
          .fn()
          .mockRejectedValue(new Error("Network timeout")),
        expectedAuthorLogin: "holon-reviewer[bot]",
        listWorkflowRunArtifacts: vi
          .fn()
          .mockResolvedValue([{ id: 10, name: "coverage", sizeInBytes: 100 }]),
      }),
    };

    await expect(
      enrichReviewWithCiEvidence(fakeEnv, baseInput, deps),
    ).rejects.toThrow("download");
  });

  it("returns no_valid_reports when zip has no test/coverage data", async () => {
    const emptyZip = zipSync({
      "dummy.txt": new TextEncoder().encode("not coverage"),
    });

    const deps: CiEnrichmentDependencies = {
      ledger: {
        loadCiEvidence: vi.fn(),
        saveCiEvidence: vi.fn(),
        loadLatestReviewDecision: vi.fn().mockResolvedValue({
          runId: `github:42:pr:7:head:${baseInput.headSha}:base:${"b".repeat(40)}`,
          output: { language: "en", detail: "concise", maxInlineComments: 40 },
        }),
      },
      createSession: vi.fn().mockResolvedValue({
        api: {},
        currentPullRequestRefs: vi.fn().mockResolvedValue({
          headSha: baseInput.headSha,
          baseSha: "b".repeat(40),
        }),
        downloadArtifactZip: vi.fn().mockResolvedValue(emptyZip.buffer),
        expectedAuthorLogin: "holon-reviewer[bot]",
        listWorkflowRunArtifacts: vi
          .fn()
          .mockResolvedValue([{ id: 10, name: "coverage", sizeInBytes: 100 }]),
      }),
    };

    const result = await enrichReviewWithCiEvidence(fakeEnv, baseInput, deps);
    expect(result).toEqual({ enriched: false, reason: "no_valid_reports" });
  });

  it("persists CI evidence to ledger when review summary cannot be located yet (CI finishes before review)", async () => {
    const lcov = "SF:src/index.ts\nDA:1,3\nend_of_record\n";
    const zip = zipSync({
      "coverage.lcov": new TextEncoder().encode(lcov),
    });

    const saveCiEvidenceMock = vi.fn().mockResolvedValue(undefined);

    const deps: CiEnrichmentDependencies = {
      createSession: vi.fn().mockResolvedValue({
        api: {},
        currentPullRequestRefs: vi.fn().mockResolvedValue({
          headSha: baseInput.headSha,
          baseSha: "b".repeat(40),
        }),
        downloadArtifactZip: vi.fn().mockResolvedValue(zip.buffer),
        expectedAuthorLogin: "holon-reviewer[bot]",
        listWorkflowRunArtifacts: vi
          .fn()
          .mockResolvedValue([{ id: 10, name: "coverage", sizeInBytes: 100 }]),
        pullRequestDiff: vi
          .fn()
          .mockResolvedValue(
            "diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -0,0 +1,1 @@\n+const x = 1;\n",
          ),
      }),
      ledger: {
        loadCiEvidence: vi.fn(),
        loadLatestReviewDecision: vi.fn(),
        saveCiEvidence: saveCiEvidenceMock,
      },
    };

    const result = await enrichReviewWithCiEvidence(fakeEnv, baseInput, deps);
    expect(result).toEqual({ enriched: true, reason: "saved_pending_review" });
    expect(saveCiEvidenceMock).toHaveBeenCalledTimes(1);
    expect(saveCiEvidenceMock.mock.calls[0]?.[1]).toBe(baseInput.headSha);
    expect(
      saveCiEvidenceMock.mock.calls[0]?.[2]?.markdownByLanguage.en,
    ).toContain("### 🧪 CI Test & Coverage Evidence");
  });
});

// Publication, default publisher, and unchanged-body regressions are in
// ci-publication.test.ts against the real Durable Object and publisher.
