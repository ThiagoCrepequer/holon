import {
  createCheckRunInputSchema,
  gitShaSchema,
  positiveIntegerSchema,
  runIdSchema,
  reviewOutputPreferencesSchema,
} from "@holon/contracts";
import { createPrKey, createRunId, reviewMessage } from "@holon/domain";
import {
  createInstallationSessionWithKeyring,
  GitHubReviewPublisher,
} from "@holon/github";
import { z } from "zod";

import { resolveControlPlaneKeyring } from "../github/github-credentials.js";

export const desiredCheckRunSchema = z.strictObject({
  language: reviewOutputPreferencesSchema.shape.language,
  baseSha: gitShaSchema,
  installationId: positiveIntegerSchema,
  repositoryId: positiveIntegerSchema,
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
  pullNumber: positiveIntegerSchema,
  input: createCheckRunInputSchema,
});
export type DesiredCheckRun = z.infer<typeof desiredCheckRunSchema>;

export class CheckRunReconciliationStore {
  constructor(private readonly storage: DurableObjectStorage) {}
  schedule(runId: string, raw: DesiredCheckRun): number {
    const desired = desiredCheckRunSchema.parse(raw);
    if (
      runIdSchema.parse(runId) !== desired.input.externalId ||
      runId !==
        createRunId(
          createPrKey({
            provider: "github",
            repositoryId: desired.repositoryId,
            pullRequestNumber: desired.pullNumber,
          }),
          desired.input.headSha,
          desired.baseSha,
        )
    )
      throw new Error("Check run identity mismatch");
    return this.storage.transactionSync(() => {
      const run = this.storage.sql
        .exec("SELECT id FROM runs WHERE id=?", runId)
        .toArray()[0];
      if (!run) throw new Error("Check run authority is unavailable");
      const existing = this.storage.sql
        .exec<{ payload: string; revision: number }>(
          "SELECT payload,revision FROM check_run_tasks WHERE run_id=?",
          runId,
        )
        .toArray()[0];
      const payload = JSON.stringify(desired);
      if (existing) {
        const previous = desiredCheckRunSchema.parse(
          JSON.parse(existing.payload),
        );
        if (
          existing.payload === payload ||
          (previous.input.status === "completed" &&
            desired.input.status !== "completed")
        )
          return existing.revision;
      }
      const revision = (existing?.revision ?? 0) + 1;
      this.storage.sql.exec(
        "INSERT INTO check_run_tasks(run_id,payload,revision,completed_revision,attempts,next_attempt_at) VALUES(?,?,?,0,0,?) ON CONFLICT(run_id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,attempts=0,next_attempt_at=excluded.next_attempt_at",
        runId,
        payload,
        revision,
        new Date(Date.now() + 30000).toISOString(),
      );
      return revision;
    });
  }
  complete(runId: string, revision: number): void {
    this.storage.sql.exec(
      "UPDATE check_run_tasks SET completed_revision=CASE WHEN revision=? THEN ? ELSE 0 END, next_attempt_at=? WHERE run_id=? AND revision>=?",
      revision,
      revision,
      new Date(Date.now() + 30000).toISOString(),
      runId,
      revision,
    );
  }
  async processDue(
    env: Cloudflare.Env,
    now: string,
    connect?: (
      target: DesiredCheckRun,
    ) => ReturnType<typeof createInstallationSessionWithKeyring>,
    runId?: string,
  ): Promise<void> {
    const row = this.storage.sql
      .exec<{
        run_id: string;
        payload: string;
        revision: number;
        attempts: number;
      }>(
        "SELECT run_id,payload,revision,attempts FROM check_run_tasks WHERE revision>completed_revision AND (next_attempt_at<=? OR run_id=?) ORDER BY CASE WHEN run_id=? THEN 0 ELSE 1 END, next_attempt_at LIMIT 1",
        now,
        runId ?? null,
        runId ?? null,
      )
      .toArray()[0];
    if (!row) return;
    try {
      const desired = desiredCheckRunSchema.parse(JSON.parse(row.payload));
      const session = connect
        ? await connect(desired)
        : await createInstallationSessionWithKeyring(
            resolveControlPlaneKeyring(env),
            desired.installationId,
            desired.repositoryId,
          );
      const publisher = new GitHubReviewPublisher(session.api, {
        ...desired,
        headSha: desired.input.headSha,
        expectedAuthorLogin: session.expectedAuthorLogin,
      });
      let input = desired.input;
      const run = this.storage.sql
        .exec<{ state: string; github_check_run_id: number | null }>(
          "SELECT state,github_check_run_id FROM runs WHERE id=?",
          row.run_id,
        )
        .toArray()[0];
      if (!run) throw new Error("Check run authority is unavailable");
      // An old snapshot may only finalize its own check; never present it as current.
      const refs = await session.currentPullRequestRefs(
        desired.owner,
        desired.repo,
        desired.pullNumber,
      );
      if (
        run.state === "obsolete" ||
        refs.headSha !== input.headSha ||
        refs.baseSha !== desired.baseSha
      )
        input = {
          ...input,
          status: "completed",
          conclusion: "cancelled",
          completedAt: new Date().toISOString(),
          output: {
            title: reviewMessage(desired.language, "supersededTitle"),
            summary: reviewMessage(desired.language, "superseded"),
          },
        };
      else if (run.state === "failed_terminal")
        input = {
          ...input,
          status: "completed",
          conclusion: "failure",
          completedAt: new Date().toISOString(),
          output:
            input.status === "completed" && input.conclusion === "failure"
              ? input.output
              : {
                  title: reviewMessage(desired.language, "failedTitle"),
                  summary: reviewMessage(desired.language, "failed"),
                },
        };
      const id =
        run.github_check_run_id ??
        (await publisher.findCheckRunByExternalId(row.run_id));
      const checkRunId = id ?? (await publisher.createCheckRun(input));
      if (id !== undefined)
        await publisher.updateCheckRun({ ...input, checkRunId });
      this.storage.sql.exec(
        "UPDATE runs SET github_check_run_id=? WHERE id=?",
        checkRunId,
        row.run_id,
      );
      this.complete(row.run_id, row.revision);
    } catch {
      const delay = Math.min(300000, 1000 * 2 ** Math.min(row.attempts + 1, 9));
      this.storage.sql.exec(
        "UPDATE check_run_tasks SET attempts=attempts+1,next_attempt_at=? WHERE run_id=? AND revision=?",
        new Date(Date.now() + delay).toISOString(),
        row.run_id,
        row.revision,
      );
    }
  }
}
