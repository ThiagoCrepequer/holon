import { zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { enrichReviewWithCiEvidence } from "../src/ci-enrichment-service.js";
const fakeEnv = {
  GITHUB_APP_ID: "12345",
  GITHUB_APP_PRIVATE_KEY_CURRENT: "fake-key",
  GITHUB_APP_SLUG: "holon-reviewer",
} as Cloudflare.Env;
const input = {
  deliveryId: "delivery",
  headSha: "a".repeat(40),
  installationId: 99,
  pullRequestNumber: 7,
  repository: { id: 42, name: "api", owner: "acme" },
  workflowName: "CI Gate",
  workflowRunId: 789,
  workflowRunAttempt: 2,
};
function fixture() {
  const zip = zipSync({
    "coverage.lcov": new TextEncoder().encode(
      "SF:src/index.ts\nDA:1,3\nend_of_record\n",
    ),
    "junit.xml": new TextEncoder().encode(
      '<testsuite tests="2" failures="0"/>',
    ),
  });
  const session = {
    api: {},
    expectedAuthorLogin: "holon-reviewer[bot]",
    downloadArtifactZip: vi.fn().mockResolvedValue(zip.buffer),
    listWorkflowRunArtifacts: vi
      .fn()
      .mockResolvedValue([{ id: 10, name: "coverage", sizeInBytes: 100 }]),
    currentPullRequestRefs: vi
      .fn()
      .mockResolvedValue({ headSha: input.headSha, baseSha: "b".repeat(40) }),
    pullRequestDiff: vi
      .fn()
      .mockResolvedValue(
        "diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -0,0 +1,1 @@\n+return 1;\n",
      ),
  };
  const ledger = {
    loadLatestReviewDecision: vi.fn(),
    loadCiEvidence: vi.fn(),
    saveCiEvidence: vi.fn(),
  };
  return {
    session,
    ledger,
    dependencies: { createSession: vi.fn().mockResolvedValue(session), ledger },
  };
}
describe("CI enrichment", () => {
  it("persists run/attempt identity and delegates publication to the durable outbox", async () => {
    const f = fixture();
    expect(
      await enrichReviewWithCiEvidence(fakeEnv, input, f.dependencies),
    ).toEqual({ enriched: true, reason: "saved_pending_review" });
    expect(f.ledger.saveCiEvidence).toHaveBeenCalledWith(
      "github:42:pr:7",
      input.headSha,
      expect.objectContaining({
        workflowRunId: 789,
        workflowRunAttempt: 2,
        markdownByLanguage: expect.objectContaining({
          en: expect.stringContaining("100%"),
          "pt-BR": expect.stringContaining("Suíte de testes"),
          es: expect.stringContaining("Suite de pruebas"),
        }),
        structuredCi: expect.objectContaining({ total: 2 }),
      }),
    );
  });
  it.each(["before", "during"])(
    "does not compare CI from an old SHA with a changed PR %s diff retrieval",
    async (when) => {
      const f = fixture();
      const stale = { headSha: "c".repeat(40), baseSha: "b".repeat(40) };
      if (when === "before")
        f.session.currentPullRequestRefs.mockResolvedValue(stale);
      else
        f.session.currentPullRequestRefs
          .mockResolvedValueOnce({
            headSha: input.headSha,
            baseSha: "b".repeat(40),
          })
          .mockResolvedValue(stale);
      await enrichReviewWithCiEvidence(fakeEnv, input, f.dependencies);
      expect(
        f.ledger.saveCiEvidence.mock.calls[0]?.[2].markdownByLanguage.en,
      ).not.toContain("Changed lines coverage");
      if (when === "before")
        expect(f.session.pullRequestDiff).not.toHaveBeenCalled();
    },
  );
  it("retries session/download failures instead of acknowledging them", async () => {
    const f = fixture();
    f.dependencies.createSession.mockRejectedValueOnce(new Error("network"));
    await expect(
      enrichReviewWithCiEvidence(fakeEnv, input, f.dependencies),
    ).rejects.toThrow("network");
    f.session.downloadArtifactZip.mockRejectedValue(new Error("network"));
    await expect(
      enrichReviewWithCiEvidence(fakeEnv, input, f.dependencies),
    ).rejects.toThrow("download");
  });
  it("ignores absent or unrecognized reports", async () => {
    const f = fixture();
    f.session.listWorkflowRunArtifacts.mockResolvedValueOnce([]);
    expect(
      await enrichReviewWithCiEvidence(fakeEnv, input, f.dependencies),
    ).toMatchObject({ reason: "no_artifacts" });
    f.session.downloadArtifactZip.mockResolvedValue(
      zipSync({ "pom.xml": new TextEncoder().encode("<project/>") }).buffer,
    );
    expect(
      await enrichReviewWithCiEvidence(fakeEnv, input, f.dependencies),
    ).toMatchObject({ reason: "no_valid_reports" });
    expect(f.ledger.saveCiEvidence).not.toHaveBeenCalled();
  });
});

it("retries a partially failed artifact download instead of publishing incomplete success", async () => {
  const f = fixture();
  f.session.listWorkflowRunArtifacts.mockResolvedValue([
    { id: 1, name: "unit", sizeInBytes: 100 },
    { id: 2, name: "integration", sizeInBytes: 100 },
  ]);
  f.session.downloadArtifactZip.mockRejectedValueOnce(new Error("network"));
  await expect(
    enrichReviewWithCiEvidence(fakeEnv, input, f.dependencies),
  ).rejects.toThrow("download");
  expect(f.ledger.saveCiEvidence).not.toHaveBeenCalled();
});

it("reports the artifact budget instead of claiming complete CI evidence", async () => {
  const f = fixture();
  f.session.listWorkflowRunArtifacts.mockResolvedValue(
    Array.from({ length: 4 }, (_, index) => ({
      id: index + 1,
      name: "tests",
      sizeInBytes: 100,
    })),
  );
  await enrichReviewWithCiEvidence(fakeEnv, input, f.dependencies);
  expect(f.session.downloadArtifactZip).toHaveBeenCalledTimes(3);
  expect(f.ledger.saveCiEvidence.mock.calls[0]?.[2]).toMatchObject({
    structuredCi: { status: "partial" },
    markdownByLanguage: expect.objectContaining({
      en: expect.stringContaining("omitted by the per-execution"),
    }),
  });
});
it("does not pretend persistence succeeded without a ledger", async () => {
  const f = fixture();
  await expect(
    enrichReviewWithCiEvidence(
      fakeEnv,
      { ...input, workflowName: undefined },
      { createSession: f.dependencies.createSession },
    ),
  ).rejects.toThrow("ledger is unavailable");
});
it("supports coverage-only and tests-only artifacts without invented test counts or coverage", async () => {
  for (const kind of ["coverage", "tests"]) {
    const f = fixture();
    const files: Record<string, Uint8Array> =
      kind === "coverage"
        ? {
            "coverage.lcov": new TextEncoder().encode(
              "SF:src/index.ts\nDA:1,0\nend_of_record",
            ),
          }
        : {
            "junit.xml": new TextEncoder().encode(
              '<testsuite tests="1" failures="0"/>',
            ),
          };
    f.session.downloadArtifactZip.mockResolvedValue(zipSync(files).buffer);
    await enrichReviewWithCiEvidence(
      fakeEnv,
      { ...input, workflowName: "" },
      f.dependencies,
    );
    const saved = f.ledger.saveCiEvidence.mock.calls[0]?.[2];
    expect(saved.structuredCi.status).toBe("partial");
    expect(saved.structuredCi.workflowName).toBeNull();
    if (kind === "coverage") expect(saved.structuredCi.total).toBe(0);
    else
      expect(saved.markdownByLanguage.en).not.toContain(
        "Changed lines coverage",
      );
  }
});
it("rejects incomplete session capabilities without downloading", async () => {
  const result = await enrichReviewWithCiEvidence(fakeEnv, input, {
    createSession: vi
      .fn()
      .mockResolvedValue({ expectedAuthorLogin: "holon-reviewer[bot]" }),
  });
  expect(result.reason).toBe("unsupported_session");
});
