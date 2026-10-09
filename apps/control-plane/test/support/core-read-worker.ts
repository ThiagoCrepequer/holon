import type { ReviewRun } from "@holon/domain";
import { WorkerEntrypoint } from "cloudflare:workers";
export { ReviewLedgerObject } from "../../src/ledger/ledger-object.js";
export { DashboardReviewReader } from "../../src/dashboard-read-entrypoint.js";
/** Test-only fixture generation uses the production ledger and projection writer. */
export default class ReviewFixture extends WorkerEntrypoint<Cloudflare.Env> {
  override async fetch(request: Request) {
    const { subject, count = 65 } = (await request.json()) as {
      subject: number;
      count?: number;
    };
    if (
      !Number.isSafeInteger(subject) ||
      subject < 1 ||
      count > 100 ||
      count < 1
    )
      return new Response(null, { status: 400 });
    for (let number = 1; number <= count; number++) {
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
      await ledger.saveReviewAnalysis(run.id, {
        findings: [],
        activeFindings: [],
        updatedTrackedFindings: [],
        resolvedFindings: [],
        summary: "Synthetic evidence </script><svg onload=hostile()>",
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
