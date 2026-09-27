import {
  adminCiSummarySchema,
  gitShaSchema,
  prKeySchema,
  savedCiEvidenceSchema,
  type AdminCiSummary,
  type SavedCiEvidence,
} from "@holon/contracts";
import {
  appendCiEvidenceToSummary,
  buildPublicationMarker,
  CI_EVIDENCE_MARKER_START,
  CI_EVIDENCE_MARKER_END,
  createPrKey,
  createRunId,
} from "@holon/domain";
import {
  createInstallationSessionWithKeyring,
  GitHubReviewPublisher,
} from "@holon/github";

import { resolveControlPlaneKeyring } from "./github-credentials.js";

export class CiEvidenceStore {
  constructor(private readonly storage: DurableObjectStorage) {}
  save(prKey: string, headSha: string, raw: SavedCiEvidence): void {
    prKeySchema.parse(prKey);
    gitShaSchema.parse(headSha);
    const value = savedCiEvidenceSchema.parse(raw);
    if (
      createPrKey({
        provider: "github",
        repositoryId: value.target.repositoryId,
        pullRequestNumber: value.target.pullNumber,
      }) !== prKey
    )
      throw new Error("CI target mismatch");
    this.storage.transactionSync(() => {
      const previous = this.storage.sql
        .exec<{ attempt: number; payload: string }>(
          "SELECT attempt,payload FROM ci_workflow_evidence WHERE pr_key=? AND head_sha=? AND workflow_run_id=?",
          prKey,
          headSha,
          value.workflowRunId,
        )
        .toArray()[0];
      const payload = JSON.stringify(value);
      if (
        previous &&
        (previous.attempt > value.workflowRunAttempt ||
          previous.payload === payload)
      )
        return;
      this.storage.sql.exec(
        "INSERT INTO ci_workflow_evidence(pr_key,head_sha,workflow_run_id,attempt,payload) VALUES(?,?,?,?,?) ON CONFLICT(pr_key,head_sha,workflow_run_id) DO UPDATE SET attempt=excluded.attempt,payload=excluded.payload",
        prKey,
        headSha,
        value.workflowRunId,
        value.workflowRunAttempt,
        payload,
      );
      this.storage.sql.exec(
        "INSERT INTO ci_publication_tasks(pr_key,head_sha,target,revision,completed_revision,attempts,next_attempt_at) VALUES(?,?,?,1,0,0,?) ON CONFLICT(pr_key,head_sha) DO UPDATE SET target=excluded.target,revision=revision+1,attempts=0,next_attempt_at=excluded.next_attempt_at",
        prKey,
        headSha,
        JSON.stringify(value.target),
        new Date(Date.now() + 30000).toISOString(),
      );
    });
  }
  load(
    prKey: string,
    headSha: string,
  ): { markdown: string; structuredCi: AdminCiSummary | null } | undefined {
    const rows = this.storage.sql
      .exec<{ payload: string }>(
        "SELECT payload FROM ci_workflow_evidence WHERE pr_key=? AND head_sha=? ORDER BY workflow_run_id DESC LIMIT 20",
        prKey,
        headSha,
      )
      .toArray();
    if (!rows.length) return undefined;
    const values = rows
      .slice(0, 20)
      .map((row) => savedCiEvidenceSchema.parse(JSON.parse(row.payload)));
    const sections = values.map(
      (value) =>
        `#### Workflow run #${value.workflowRunId}, attempt ${value.workflowRunAttempt}\n\n${value.markdown.replace(CI_EVIDENCE_MARKER_START, "").replace(CI_EVIDENCE_MARKER_END, "")}`,
    );
    let bytes = 0;
    const total = this.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM ci_workflow_evidence WHERE pr_key=? AND head_sha=?",
        prKey,
        headSha,
      )
      .one().count;
    let omitted = total - values.length;
    const visible = sections.filter((section) => {
      const size = new TextEncoder().encode(section).length;
      if (bytes + size > 24000) {
        omitted++;
        return false;
      }
      bytes += size;
      return true;
    });
    const summaries = values.flatMap((v) =>
      v.structuredCi ? [v.structuredCi] : [],
    );
    const sum = (key: "total" | "passed" | "failed" | "skipped") =>
      summaries.reduce((n, s) => n + s[key], 0);
    const structuredCi: AdminCiSummary | null = summaries.length
      ? adminCiSummarySchema.parse({
          total: sum("total"),
          passed: sum("passed"),
          failed: sum("failed"),
          skipped: sum("skipped"),
          durationMs: summaries.every((s) => s.durationMs !== null)
            ? summaries.reduce((n, s) => n + s.durationMs!, 0)
            : null,
          status:
            omitted || summaries.some((s) => s.status !== "available")
              ? "partial"
              : "available",
          workflowName:
            values.length === 1
              ? summaries[0]!.workflowName
              : `${values.length} workflow runs`,
        })
      : null;
    return {
      markdown: [
        CI_EVIDENCE_MARKER_START,
        ...visible,
        ...(omitted
          ? [
              `*Additional CI executions omitted from this bounded summary: ${omitted}.*`,
            ]
          : []),
        CI_EVIDENCE_MARKER_END,
      ].join("\n\n"),
      structuredCi,
    };
  }
  async processDue(env: Cloudflare.Env, now: string): Promise<void> {
    const row = this.storage.sql
      .exec<{
        pr_key: string;
        head_sha: string;
        target: string;
        revision: number;
        attempts: number;
      }>(
        "SELECT * FROM ci_publication_tasks WHERE revision>completed_revision AND next_attempt_at<=? ORDER BY next_attempt_at LIMIT 1",
        now,
      )
      .toArray()[0];
    if (!row) return;
    try {
      const target = JSON.parse(row.target) as SavedCiEvidence["target"];
      const session = await createInstallationSessionWithKeyring(
        resolveControlPlaneKeyring(env),
        target.installationId,
        target.repositoryId,
      );
      const publisher = new GitHubReviewPublisher(session.api, {
        ...target,
        headSha: row.head_sha,
        expectedAuthorLogin: session.expectedAuthorLogin,
      });
      const runId = createRunId(
        row.pr_key as Parameters<typeof createRunId>[0],
        row.head_sha,
      );
      const review = await publisher.findCommentWithBodyByMarker(
        buildPublicationMarker(runId, "summary"),
        "summary",
      );
      if (!review) throw new Error("CI summary publication is pending");
      const evidence = this.load(row.pr_key, row.head_sha);
      if (!evidence) throw new Error("CI evidence is unavailable");
      const body = appendCiEvidenceToSummary(review.body, evidence.markdown);
      if (body !== review.body)
        await publisher.updateReviewComment(review.id, body);
      this.storage.sql.exec(
        "UPDATE ci_publication_tasks SET completed_revision=? WHERE pr_key=? AND head_sha=? AND revision=?",
        row.revision,
        row.pr_key,
        row.head_sha,
        row.revision,
      );
    } catch {
      this.storage.sql.exec(
        "UPDATE ci_publication_tasks SET attempts=attempts+1,next_attempt_at=? WHERE pr_key=? AND head_sha=? AND revision=?",
        new Date(
          Date.now() +
            Math.min(300000, 1000 * 2 ** Math.min(row.attempts + 1, 9)),
        ).toISOString(),
        row.pr_key,
        row.head_sha,
        row.revision,
      );
    }
  }
}
