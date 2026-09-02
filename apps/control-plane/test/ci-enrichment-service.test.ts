import { zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import {
  enrichReviewWithCiEvidence,
  type CiEnrichmentDependencies,
} from "../src/ci-enrichment-service.js";

const fakeEnv = {
  GITHUB_APP_ID: "12345",
  GITHUB_APP_PRIVATE_KEY: "fake-key",
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
};

describe("CI Enrichment Service", () => {
  it("returns session_failed when credentials fail", async () => {
    const invalidEnv = {
      ...fakeEnv,
      GITHUB_APP_ID: "invalid",
    };
    const result = await enrichReviewWithCiEvidence(invalidEnv, baseInput);
    expect(result).toEqual({ enriched: false, reason: "session_failed" });
  });

  it("returns unsupported_session when session lacks artifact methods", async () => {
    const deps: CiEnrichmentDependencies = {
      createSession: vi.fn().mockResolvedValue({
        api: {},
        expectedAuthorLogin: "holon-reviewer[bot]",
      }),
    };

    const result = await enrichReviewWithCiEvidence(fakeEnv, baseInput, deps);
    expect(result).toEqual({ enriched: false, reason: "unsupported_session" });
  });

  it("returns no_artifacts when workflow run has no artifacts", async () => {
    const deps: CiEnrichmentDependencies = {
      createSession: vi.fn().mockResolvedValue({
        api: {},
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
      createSession: vi.fn().mockResolvedValue({
        api: {},
        downloadArtifactZip: vi
          .fn()
          .mockRejectedValue(new Error("Network timeout")),
        expectedAuthorLogin: "holon-reviewer[bot]",
        listWorkflowRunArtifacts: vi
          .fn()
          .mockResolvedValue([{ id: 10, name: "coverage", sizeInBytes: 100 }]),
      }),
    };

    const result = await enrichReviewWithCiEvidence(fakeEnv, baseInput, deps);
    expect(result).toEqual({ enriched: false, reason: "download_failed" });
  });

  it("returns no_valid_reports when zip has no test/coverage data", async () => {
    const emptyZip = zipSync({
      "dummy.txt": new TextEncoder().encode("not coverage"),
    });

    const deps: CiEnrichmentDependencies = {
      createSession: vi.fn().mockResolvedValue({
        api: {},
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

  it("returns summary_not_found when review summary cannot be located", async () => {
    const lcov = "SF:src/index.ts\nDA:1,3\nend_of_record\n";
    const zip = zipSync({
      "coverage.lcov": new TextEncoder().encode(lcov),
    });

    const deps: CiEnrichmentDependencies = {
      createPublisher: vi.fn().mockReturnValue({
        findCommentWithBodyByMarker: vi.fn().mockResolvedValue(undefined),
      }),
      createSession: vi.fn().mockResolvedValue({
        api: {},
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
    };

    const result = await enrichReviewWithCiEvidence(fakeEnv, baseInput, deps);
    expect(result).toEqual({ enriched: false, reason: "summary_not_found" });
  });

  it("enriches review comment when valid artifacts and existing summary exist", async () => {
    const lcov = "SF:src/index.ts\nDA:1,3\nend_of_record\n";
    const junit = '<testsuite name="unit" tests="2" failures="0" />';
    const zip = zipSync({
      "coverage.lcov": new TextEncoder().encode(lcov),
      "junit.xml": new TextEncoder().encode(junit),
    });

    const updateReviewMock = vi.fn().mockResolvedValue(undefined);

    const deps: CiEnrichmentDependencies = {
      createPublisher: vi.fn().mockReturnValue({
        findCommentWithBodyByMarker: vi.fn().mockResolvedValue({
          body: "Original summary\n\n<!-- holon:summary -->",
          id: 888,
        }),
        updateReviewComment: updateReviewMock,
      }),
      createSession: vi.fn().mockResolvedValue({
        api: {},
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
    };

    const result = await enrichReviewWithCiEvidence(fakeEnv, baseInput, deps);
    expect(result).toEqual({ enriched: true });
    expect(updateReviewMock).toHaveBeenCalledTimes(1);
    expect(updateReviewMock.mock.calls[0]?.[0]).toBe(888);
    expect(updateReviewMock.mock.calls[0]?.[1]).toContain(
      "### 🧪 CI Test & Coverage Evidence",
    );
    expect(updateReviewMock.mock.calls[0]?.[1]).toContain("Original summary");
  });

  it("returns no_changes when review body is already up-to-date", async () => {
    const lcov = "SF:src/index.ts\nDA:1,3\nend_of_record\n";
    const zip = zipSync({
      "coverage.lcov": new TextEncoder().encode(lcov),
    });

    const updateReviewMock = vi.fn().mockResolvedValue(undefined);

    const deps: CiEnrichmentDependencies = {
      createPublisher: vi.fn().mockReturnValue({
        findCommentWithBodyByMarker: vi.fn().mockImplementation(async () => {
          // Simulate first run output already present
          const { ingestCiArtifactZips } = await import("@holon/application");
          const {
            calculateChangedLinesCoverage,
            formatCiEvidenceMarkdown,
            appendCiEvidenceToSummary,
          } = await import("@holon/domain");
          const evidence = ingestCiArtifactZips([zip.buffer], {
            source: "github-actions",
            workflowName: baseInput.workflowName,
            workflowRunId: baseInput.workflowRunId,
          });
          const changedCoverage = calculateChangedLinesCoverage(
            [{ line: 1, path: "src/index.ts", side: "RIGHT" }],
            evidence.coverage ?? [],
          );
          const evidenceMd = formatCiEvidenceMarkdown(
            evidence,
            changedCoverage,
          );
          const body = appendCiEvidenceToSummary(
            "Original summary\n\n<!-- holon:summary -->",
            evidenceMd,
          );
          return { body, id: 888 };
        }),
        updateReviewComment: updateReviewMock,
      }),
      createSession: vi.fn().mockResolvedValue({
        api: {},
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
    };

    const result = await enrichReviewWithCiEvidence(fakeEnv, baseInput, deps);
    expect(result).toEqual({ enriched: false, reason: "no_changes" });
    expect(updateReviewMock).not.toHaveBeenCalled();
  });

  it("uses default publisher when createPublisher is omitted", async () => {
    const lcov = "SF:src/index.ts\nDA:1,3\nend_of_record\n";
    const zip = zipSync({
      "coverage.lcov": new TextEncoder().encode(lcov),
    });

    const fakeApi = {
      iterate: async function* () {
        yield [
          {
            body: "Original summary\n\n<!-- holon:v1;run=github%3A42%3Apr%3A7%3Ahead%3Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;finding=summary -->",
            id: 999,
            user: { login: "holon-reviewer[bot]", type: "Bot" },
          },
        ];
      },
      request: vi.fn().mockResolvedValue({ data: { id: 999 } }),
    };

    const deps: CiEnrichmentDependencies = {
      createSession: vi.fn().mockResolvedValue({
        api: fakeApi,
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
    };

    const result = await enrichReviewWithCiEvidence(fakeEnv, baseInput, deps);
    expect(result).toEqual({ enriched: true });
    expect(fakeApi.request).toHaveBeenCalledWith(
      "PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}",
      expect.objectContaining({ review_id: 999 }),
    );
  });
});
