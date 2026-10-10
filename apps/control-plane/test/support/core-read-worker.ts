import type { ReviewRun } from "@holon/domain";
import { WorkerEntrypoint } from "cloudflare:workers";
export { ReviewLedgerObject } from "../../src/ledger/ledger-object.js";
export { DashboardReviewReader } from "../../src/dashboard-read-entrypoint.js";
/** Test-only fixture generation uses the production ledger and projection writer. */
export default class ReviewFixture extends WorkerEntrypoint<Cloudflare.Env> {
  override async fetch(request: Request) {
    const {
      subject,
      count = 10,
      offset = 0,
      findingCount = 0,
    } = (await request.json()) as {
      subject: number;
      count?: number;
      offset?: number;
      findingCount?: number;
    };
    if (
      !Number.isSafeInteger(subject) ||
      subject < 1 ||
      !Number.isSafeInteger(count) ||
      count > 10 ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset + count > 100 ||
      count < 1 ||
      !Number.isSafeInteger(findingCount) ||
      findingCount < 0 ||
      findingCount > 200
    )
      return new Response(null, { status: 400 });
    for (let number = offset + 1; number <= offset + count; number++) {
      const repositoryId = subject + 200000,
        headSha = "a".repeat(40),
        baseSha = "b".repeat(40),
        date = "2026-10-09T00:00:00.000Z",
        key = `github:${repositoryId}:pr:${number}` as const;
      const ledger = this.env.REVIEW_LEDGERS.getByName(key);
      await ledger.observePullRequest({
        installationId: subject + 100000,
        repositoryId,
        pullRequestNumber: number,
        title:
          number === 65
            ? "</script><script>window.holonHostile=true</script>"
            : `Synthetic revisão ${number}`,
        author: "synthetic",
        pullRequestState: "open",
        headSha,
        baseSha,
        sourceUpdatedAt: date,
      });
      const run: ReviewRun = {
        id: `${key}:head:${headSha}:base:${baseSha}`,
        prKey: key,
        state: "queued",
        attempt: 0,
        causalVersion: date,
        createdAt: date,
      };
      await ledger.claimRun(run, `synthetic-${subject}-${number}`);
      await ledger.transition(
        run.id,
        "queued",
        "running",
        date,
        `start-${number}`,
      );
      const findings = Array.from({ length: findingCount }, (_, index) => ({
        confidence: 0.95,
        diagnostic: "**Synthetic finding** " + "D".repeat(1900),
        evidence: Array.from({ length: 4 }, () => ({
          excerpt: 'const value = "<b>原文</b>";\n' + "E".repeat(1100),
          path: "src/file.ts",
          reason: "R".repeat(600),
          startLine: 1,
        })),
        location: {
          line: index + 1,
          path: "src/file.ts",
          side: "RIGHT" as const,
        },
        severity: "high" as const,
        suggestion: "S".repeat(3000),
        fingerprint: `fp:${index.toString(16).padStart(64, "0")}` as const,
        evidenceFingerprint: index.toString(16).padStart(64, "0"),
        status: "new" as const,
      }));
      await ledger.saveReviewAnalysis(run.id, {
        findings: [],
        activeFindings: findings,
        updatedTrackedFindings: [],
        resolvedFindings: [],
        summary: findingCount
          ? "**Synthetic summary**\n\n![tracking](https://tracker.example.invalid/pixel)\n\n[unsafe](javascript:hostile())\n\n<script>window.holonHostile=true</script>" +
            "T".repeat(14000)
          : "Synthetic evidence </script><svg onload=hostile()>",
        output: { language: "en", detail: "concise", maxInlineComments: 40 },
        omissionReasons: [],
        scopeStatus: "complete",
        shardsAnalyzed: 1,
        totalShards: 1,
      });
      await ledger.transition(
        run.id,
        "running",
        "publishing",
        date,
        `publish-${number}`,
      );
      await ledger.transition(
        run.id,
        "publishing",
        "completed",
        date,
        `complete-${number}`,
      );
    }
    return Response.json({ seeded: count });
  }
}
