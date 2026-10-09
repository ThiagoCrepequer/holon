import type {
  AppliedFindingFeedback,
  ApplyFindingFeedbackInput,
  ClaimedPublication,
  FeedbackLedger,
  ReviewDecisionContext,
  ReviewLedger,
} from "@holon/application";
import {
  type MemorySnapshot,
  memoryRecordResultSchema,
  reconciledReviewOutputSchema as memoryReviewOutputSchema,
} from "@holon/contracts";
import type {
  ReviewBudgetPlan,
  ModelGenerationReservation,
  ModelGenerationStopReason,
  ModelGenerationAdmission,
} from "@holon/contracts";
import type {
  RunConfigurationRef,
  RunConfigurationSnapshot,
} from "@holon/contracts";
import {
  projectIdentificationResultSchema,
  type ProjectIdentificationResult,
} from "@holon/contracts";
import {
  githubCredentialRequestSchema,
  positiveIntegerSchema,
  publicationIdSchema,
  publicationRecordSchema,
  runClaimSchema,
  runClaimResultSchema,
  runIdSchema,
  runStateSchema,
  runTransitionSchema,
  timestampSchema,
  type FindingFeedbackRecord,
  type GitHubCredentialRequest,
  type RunClaimResult,
  type SupersededWorkflow,
  type TrackedFinding,
} from "@holon/contracts";
import type {
  ReconciledReviewOutput,
  ReviewAnalysisCheckpoint,
  ClarificationAdmission,
  ClarificationRead,
} from "@holon/contracts";
import {
  projectionWriteResultSchema,
  pullRequestMetadataSchema,
  type ReviewProjectionWriterPort,
  type CoreReviewDetailResult,
} from "@holon/contracts/dashboard-reviews";
import type {
  FindingFingerprint,
  PrKey,
  PublicationId,
  PublicationRecord,
  ReviewRun,
  RunId,
  RunState,
} from "@holon/domain";
import { canTransitionRun } from "@holon/domain";
import { DurableObject } from "cloudflare:workers";

import { consoleLogger, errorKind } from "../observability.js";
import {
  CheckRunReconciliationStore,
  type DesiredCheckRun,
} from "./check-run-reconciliation.js";
import { FindingClarificationStore } from "./finding-clarification-store.js";
import { FindingLedgerStore } from "./finding-ledger-store.js";
import { applyLedgerMigrations } from "./ledger-migrations.js";
import { ReviewAnalysisStore } from "./review-analysis-store.js";
import { ReviewBudgetPlanStore } from "./review-budget-plan-store.js";
import { ReviewGenerationBudgetStore } from "./review-generation-budget-store.js";
import { ReviewReadModel } from "./review-read-model.js";
import { ReviewToolBudgetStore } from "./review-tool-budget-store.js";
import { RunConfigurationStore } from "./run-configuration-store.js";
import { RunMemoryStore } from "./run-memory-store.js";
import { terminateWorkflowIfActive } from "./workflow-superseding.js";

export interface PublicationRow extends Record<string, SqlStorageValue> {
  finding_id: string;
  github_comment_id: number | null;
  id: string;
  kind: string;
  marker: string;
  run_id: string;
  state: string;
}

interface CleanupRow extends Record<string, SqlStorageValue> {
  attempts: number;
  next_attempt_at: string;
  run_id: string;
  state: string;
}

interface WorkflowSupersessionRow extends Record<string, SqlStorageValue> {
  attempts: number;
  next_attempt_at: string;
  state: string;
  superseded_run_id: string;
  workflow_instance_id: string;
}

interface CredentialScopeRow extends Record<string, SqlStorageValue> {
  container_id: string;
  installation_id: number;
  repository_id: number;
  repository_name: string;
  repository_owner: string;
}

type MutationPurpose = "failure" | "review";

function rowToPublication(row: PublicationRow): PublicationRecord {
  const parsed = publicationRecordSchema.parse({
    findingId: row.finding_id,
    ...(row.github_comment_id === null
      ? {}
      : { githubCommentId: row.github_comment_id }),
    id: row.id,
    kind: row.kind,
    marker: row.marker,
    runId: row.run_id,
    state: row.state,
  });
  const { githubCommentId, ...required } = parsed;
  return {
    ...required,
    findingId: parsed.findingId as PublicationRecord["findingId"],
    id: parsed.id as PublicationId,
    runId: parsed.runId as RunId,
    ...(githubCommentId === undefined ? {} : { githubCommentId }),
  };
}

function normalizedTimestamp(raw: string): string {
  return new Date(timestampSchema.parse(raw)).toISOString();
}

function maintenanceBackoff(attempt: number): number {
  return Math.min(60 * 60_000, 5_000 * 2 ** Math.min(attempt - 1, 9));
}

const immediateTerminationGraceMilliseconds = 30_000;

function shouldPromoteRun(
  candidateId: string,
  candidateReceivedAt: string,
  candidateVersion: string,
  latestId: string | undefined,
  latestReceivedAt: string | undefined,
  latestVersion: string | undefined,
): boolean {
  if (
    latestId === undefined ||
    latestReceivedAt === undefined ||
    latestVersion === undefined
  ) {
    return true;
  }
  if (candidateVersion !== latestVersion)
    return candidateVersion > latestVersion;
  if (candidateReceivedAt !== latestReceivedAt) {
    return candidateReceivedAt > latestReceivedAt;
  }
  return candidateId > latestId;
}

export class ReviewLedgerObject
  extends DurableObject
  implements ReviewLedger, FeedbackLedger
{
  private readonly findingStore: FindingLedgerStore;
  private readonly clarificationStore: FindingClarificationStore;

  public constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    applyLedgerMigrations(this.ctx.storage);
    this.findingStore = new FindingLedgerStore(this.ctx.storage);
    this.clarificationStore = new FindingClarificationStore(this.ctx.storage);
    void this.ctx.blockConcurrencyWhile(async () => {
      await this.ensureMaintenanceAlarm();
    });
  }

  public async claimRun(
    rawRun: ReviewRun,
    rawWorkflowInstanceId: string,
  ): Promise<RunClaimResult> {
    const result = await this.mutateReadModel(() => {
      const parsed = runClaimSchema.parse({
        run: rawRun,
        workflowInstanceId: rawWorkflowInstanceId,
      });
      const receipt = runClaimResultSchema.parse(
        this.claimRunInternal(rawRun, parsed.workflowInstanceId),
      );
      const identity = /:head:([a-f0-9]{40}):base:([a-f0-9]{40})$/u.exec(
        parsed.run.id,
      );
      this.ctx.storage.sql.exec(
        "UPDATE runs SET read_head_sha=?,read_base_sha=? WHERE id=?",
        identity?.[1] ?? null,
        identity?.[2] ?? null,
        parsed.run.id,
      );
      return receipt;
    }, rawRun.causalVersion);
    return result;
  }

  private async mutateReadModel<T>(
    mutation: () => T,
    occurredAt: string,
    forceProjection = false,
  ): Promise<T> {
    if (
      !forceProjection &&
      !this.ctx.storage.sql
        .exec("SELECT 1 FROM review_read_metadata LIMIT 1")
        .toArray().length
    ) {
      const result = this.ctx.storage.transactionSync(mutation);
      await this.ensureMaintenanceAlarm();
      return result;
    }
    return this.ctx.storage.transaction(async () => {
      const result = mutation();
      await new ReviewReadModel(this.ctx.storage).touch(occurredAt);
      await this.ensureMaintenanceAlarm();
      return result;
    });
  }
  private runActivityAt(runId: string): string {
    const row = this.ctx.storage.sql
      .exec<{ updated_at: string | null; causal_version: string }>(
        "SELECT updated_at,causal_version FROM runs WHERE id=?",
        runId,
      )
      .toArray()[0];
    return row?.updated_at ?? row?.causal_version ?? new Date().toISOString();
  }
  public async observePullRequest(raw: unknown): Promise<string> {
    const input = pullRequestMetadataSchema.parse(raw);
    const expected = `github:${input.repositoryId}:pr:${input.pullRequestNumber}`;
    if (this.ctx.id.name !== undefined && this.ctx.id.name !== expected)
      throw new Error("review_scope_mismatch");
    return this.mutateReadModel(
      () => new ReviewReadModel(this.ctx.storage).observe(input),
      input.sourceUpdatedAt,
      true,
    );
  }
  public async reviewDetail(raw: unknown): Promise<CoreReviewDetailResult> {
    try {
      return {
        status: "available" as const,
        generation: new ReviewReadModel(this.ctx.storage).generation(),
        detail: new ReviewReadModel(this.ctx.storage).detail(raw),
      };
    } catch (error) {
      return {
        status:
          error instanceof Error && error.message === "review_revision_changed"
            ? "revision_changed"
            : error instanceof Error && error.message === "review_unavailable"
              ? "unavailable"
              : "invalid_request",
      };
    }
  }
  public async resumeProjection(raw: unknown): Promise<void> {
    await this.ctx.storage.transaction(async () => {
      new ReviewReadModel(this.ctx.storage).resume(raw);
      await this.ensureMaintenanceAlarm();
    });
  }
  private async deliverProjection(): Promise<void> {
    const claim = await this.ctx.storage.transaction(async () => {
      const result = new ReviewReadModel(this.ctx.storage).claim(Date.now());
      await this.ensureMaintenanceAlarm();
      return result;
    });
    if (!claim) return;
    const startedAt = Date.now();
    consoleLogger.emit("dashboard.projection_attempt", {
      attempt: claim.attempt,
      source_age_ms: Math.max(
        0,
        startedAt - Date.parse(claim.input.snapshot.observedAt),
      ),
    });
    try {
      const writer = (
        this.env as unknown as {
          REVIEW_PROJECTION?: ReviewProjectionWriterPort;
        }
      ).REVIEW_PROJECTION;
      if (!writer) throw new Error("projection_writer_unavailable");
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let reply: unknown;
      try {
        reply = await Promise.race([
          writer.write(claim.input),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("projection_deadline")),
              10000,
            );
          }),
        ]);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
      const result = projectionWriteResultSchema.parse(reply);
      consoleLogger.emit("dashboard.projection_result", {
        duration_ms: Date.now() - startedAt,
        result,
      });
      consoleLogger.emit("dashboard.projection_health", {
        code: result === "applied" || result === "duplicate" ? 0 : 1,
      });
      if (result === "applied" || result === "duplicate") {
        await this.ctx.storage.transaction(async () => {
          new ReviewReadModel(this.ctx.storage).acknowledge(
            claim.input.generation,
            claim.input.snapshot.snapshotRevision,
            claim.attempt,
          );
          await this.ensureMaintenanceAlarm();
        });
      } else
        consoleLogger.emit("dashboard.projection_blocked", {
          generation: claim.input.generation,
          revision: claim.input.snapshot.snapshotRevision,
          result,
        });
    } catch {
      consoleLogger.emit("dashboard.projection_retry", {
        attempt: claim.attempt,
        duration_ms: Date.now() - startedAt,
        code: claim.attempt >= 6 ? 2 : 1,
      });
    }
  }

  private claimRunInternal(
    rawRun: ReviewRun,
    rawWorkflowInstanceId: string,
  ): RunClaimResult {
    const { run, workflowInstanceId } = runClaimSchema.parse({
      run: rawRun,
      workflowInstanceId: rawWorkflowInstanceId,
    });
    const causalVersion = normalizedTimestamp(run.causalVersion);
    const receivedAt = normalizedTimestamp(run.createdAt);
    const sql = this.ctx.storage.sql;
    const existing = sql
      .exec<{ id: string; state: string; workflow_instance_id: string }>(
        "SELECT id, state, workflow_instance_id FROM runs WHERE id = ?",
        run.id,
      )
      .toArray()[0];
    if (existing !== undefined) {
      const isOwnedActiveRun =
        existing.workflow_instance_id === workflowInstanceId &&
        !["completed", "obsolete", "failed_terminal"].includes(existing.state);
      const outcome =
        isOwnedActiveRun && this.latestRunId() === run.id
          ? "resume"
          : "duplicate";
      return {
        outcome,
        supersededWorkflows:
          outcome === "resume" ? this.pendingWorkflowSupersessions() : [],
      };
    }
    let outcome: "claimed" | "duplicate" = "claimed";
    this.ctx.storage.transactionSync(() => {
      const metadata = Object.fromEntries(
        sql
          .exec<{ key: string; value: string }>(
            "SELECT key, value FROM metadata WHERE key IN ('latest_run_id', 'latest_causal_version', 'latest_received_at')",
          )
          .toArray()
          .map((row) => [row.key, row.value]),
      );
      let latestVersion = metadata.latest_causal_version;
      let latestReceivedAt = metadata.latest_received_at;
      if (metadata.latest_run_id !== undefined) {
        const latest = sql
          .exec<{ causal_version: string; created_at: string }>(
            "SELECT causal_version, created_at FROM runs WHERE id = ?",
            metadata.latest_run_id,
          )
          .toArray()[0];
        latestVersion ??= latest?.causal_version;
        latestReceivedAt ??= latest?.created_at;
      }
      const promote = shouldPromoteRun(
        run.id,
        receivedAt,
        causalVersion,
        metadata.latest_run_id,
        latestReceivedAt,
        latestVersion,
      );
      sql.exec(
        "INSERT INTO runs (id, pr_key, state, attempt, created_at, causal_version, workflow_instance_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        run.id,
        run.prKey,
        promote ? run.state : "obsolete",
        run.attempt,
        receivedAt,
        causalVersion,
        workflowInstanceId,
        run.updatedAt ?? null,
      );
      if (promote) {
        const activeRuns = sql
          .exec<{
            id: string;
            state: RunState;
            workflow_instance_id: string;
          }>(
            "SELECT id, state, workflow_instance_id FROM runs WHERE id <> ? AND state IN ('queued', 'running', 'publishing', 'failed_retryable') ORDER BY created_at, id",
            run.id,
          )
          .toArray();
        for (const activeRun of activeRuns) {
          const terminationFallbackAt = new Date(
            Date.now() + immediateTerminationGraceMilliseconds,
          ).toISOString();
          this.applyTransition({
            expected: runStateSchema.parse(activeRun.state),
            next: "obsolete",
            occurredAt: receivedAt,
            operationId: `supersede:${activeRun.workflow_instance_id}`,
            runId: activeRun.id,
          });
          if (this.credentialScope(activeRun.id) !== undefined) {
            this.insertCleanup(
              activeRun.id as RunId,
              receivedAt,
              terminationFallbackAt,
            );
          }
          this.insertWorkflowSupersession(
            activeRun.id as RunId,
            activeRun.workflow_instance_id,
            run.id as RunId,
            receivedAt,
            terminationFallbackAt,
          );
        }
        sql.exec(
          "INSERT INTO metadata (key, value) VALUES ('latest_run_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          run.id,
        );
        sql.exec(
          "INSERT INTO metadata (key, value) VALUES ('latest_causal_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          causalVersion,
        );
        sql.exec(
          "INSERT INTO metadata (key, value) VALUES ('latest_received_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          receivedAt,
        );
      } else {
        outcome = "duplicate";
      }
    });
    return {
      outcome,
      supersededWorkflows:
        outcome === "claimed" ? this.pendingWorkflowSupersessions() : [],
    };
  }

  public isLatestRun(runId: RunId): Promise<boolean> {
    return Promise.resolve(this.latestRunId() === runIdSchema.parse(runId));
  }

  public runState(runId: RunId): RunState | undefined {
    const parsedRunId = runIdSchema.parse(runId);
    const row = this.ctx.storage.sql
      .exec<{ state: string }>(
        "SELECT state FROM runs WHERE id = ?",
        parsedRunId,
      )
      .toArray()[0];
    return row === undefined ? undefined : runStateSchema.parse(row.state);
  }

  public recordCheckRunId(runId: RunId, checkRunId: number): void {
    const parsedRunId = runIdSchema.parse(runId);
    const parsedCheckRunId = positiveIntegerSchema.parse(checkRunId);
    this.ctx.storage.sql.exec(
      "UPDATE runs SET github_check_run_id = ? WHERE id = ?",
      parsedCheckRunId,
      parsedRunId,
    );
  }

  public checkRunId(runId: RunId): number | undefined {
    const parsedRunId = runIdSchema.parse(runId);
    const row = this.ctx.storage.sql
      .exec<{ github_check_run_id: number | null }>(
        "SELECT github_check_run_id FROM runs WHERE id = ?",
        parsedRunId,
      )
      .toArray()[0];
    return row?.github_check_run_id ?? undefined;
  }

  public async transition(
    runId: RunId,
    expected: RunState,
    next: RunState,
    occurredAt: string,
    operationId: string,
  ): Promise<void> {
    const transition = runTransitionSchema.parse({
      expected,
      next,
      occurredAt,
      operationId,
      runId,
    });
    await this.mutateReadModel(
      () => this.applyTransition(transition),
      next === "failed_retryable" ||
        (expected === "failed_retryable" && next === "running")
        ? (new ReviewReadModel(this.ctx.storage).snapshot()?.activityAt ??
            occurredAt)
        : occurredAt,
    );
  }

  public async transitionAndRequestCleanup(
    runId: RunId,
    expected: RunState,
    next: RunState,
    occurredAt: string,
    operationId: string,
  ): Promise<void> {
    const transition = runTransitionSchema.parse({
      expected,
      next,
      occurredAt,
      operationId,
      runId,
    });
    if (!["completed", "failed_terminal", "obsolete"].includes(next)) {
      throw new TypeError("Cleanup transition must be terminal");
    }
    await this.mutateReadModel(() => {
      this.applyTransition(transition);
      this.insertCleanup(runId, occurredAt);
    }, occurredAt);
    await this.ensureMaintenanceAlarm();
  }

  public async markTerminalAndRequestCleanup(
    runId: RunId,
    occurredAt: string,
    requiresCleanup: boolean,
  ): Promise<boolean> {
    const parsedRunId = runIdSchema.parse(runId);
    const parsedOccurredAt = timestampSchema.parse(occurredAt);
    let changed = false;
    await this.mutateReadModel(() => {
      const cursor = this.ctx.storage.sql.exec(
        "UPDATE runs SET state = 'failed_terminal', updated_at = ? WHERE id = ? AND state IN ('queued', 'running', 'publishing', 'failed_retryable')",
        parsedOccurredAt,
        parsedRunId,
      );
      changed = cursor.rowsWritten === 1;
      if (requiresCleanup) {
        this.insertCleanup(parsedRunId as RunId, parsedOccurredAt);
      }
    }, parsedOccurredAt);
    if (requiresCleanup) await this.ensureMaintenanceAlarm();
    return changed;
  }

  public authorizeMutation(
    runId: RunId,
    purpose: MutationPurpose,
  ): Promise<boolean> {
    const parsedRunId = runIdSchema.parse(runId);
    if (purpose !== "failure" && purpose !== "review") {
      throw new TypeError("Mutation purpose is invalid");
    }
    const requiredState =
      purpose === "review" ? "publishing" : "failed_terminal";
    return Promise.resolve(
      this.latestRunId() === parsedRunId &&
        this.runState(parsedRunId as RunId) === requiredState,
    );
  }

  public registerCredentialScope(raw: GitHubCredentialRequest): Promise<void> {
    const request = githubCredentialRequestSchema.parse(raw);
    if (
      this.latestRunId() !== request.runId ||
      !["running", "publishing"].includes(
        this.runState(request.runId as RunId) ?? "",
      )
    ) {
      throw new Error("Credential scope is not authorized");
    }
    if (
      !this.insertCredentialScope({
        ...request,
        installationId: request.installationId,
      })
    ) {
      throw new Error("Credential scope conflicts with the existing run scope");
    }
    return Promise.resolve();
  }

  public authorizeCredential(raw: GitHubCredentialRequest): Promise<boolean> {
    const parsed = githubCredentialRequestSchema.safeParse(raw);
    if (!parsed.success) return Promise.resolve(false);
    const request = parsed.data;
    if (
      this.latestRunId() !== request.runId ||
      !["running", "publishing"].includes(
        this.runState(request.runId as RunId) ?? "",
      )
    ) {
      return Promise.resolve(false);
    }
    const scope = this.credentialScope(request.runId);
    return Promise.resolve(
      scope !== undefined &&
        scope.container_id === request.containerId &&
        scope.installation_id === request.installationId &&
        scope.repository_id === request.repositoryId &&
        scope.repository_name === request.repositoryName &&
        scope.repository_owner === request.repositoryOwner,
    );
  }

  public claimPublication(
    rawRecord: PublicationRecord,
  ): Promise<ClaimedPublication> {
    publicationRecordSchema.parse(rawRecord);
    const record = rawRecord;
    if (
      this.latestRunId() !== record.runId ||
      this.runState(record.runId) !== "publishing"
    ) {
      const error = new Error("Publication is not authorized");
      error.name = "ReviewMutationNotAuthorizedError";
      throw error;
    }
    const sql = this.ctx.storage.sql;
    const existing = sql
      .exec<PublicationRow>(
        "SELECT * FROM publications WHERE id = ?",
        record.id,
      )
      .toArray()[0];
    if (existing !== undefined) {
      const stored = rowToPublication(existing);
      return Promise.resolve({
        outcome: stored.state === "published" ? "published" : "reconcile",
        record: stored,
      });
    }
    sql.exec(
      "INSERT INTO publications (id, run_id, finding_id, kind, marker, state) VALUES (?, ?, ?, ?, ?, ?)",
      record.id,
      record.runId,
      record.findingId,
      record.kind,
      record.marker,
      record.state,
    );
    return Promise.resolve({ outcome: "claimed", record });
  }

  public async completePublication(
    rawId: PublicationId,
    rawGithubCommentId: number,
  ): Promise<void> {
    const id = publicationIdSchema.parse(rawId);
    const githubCommentId = positiveIntegerSchema.parse(rawGithubCommentId);
    const existing = this.ctx.storage.sql
      .exec<PublicationRow>("SELECT * FROM publications WHERE id = ?", id)
      .toArray()[0];
    if (
      existing?.state === "published" &&
      existing.github_comment_id === githubCommentId
    ) {
      return;
    }
    const cursor = this.ctx.storage.sql.exec(
      "UPDATE publications SET state = 'published', github_comment_id = ? WHERE id = ? AND state = 'publishing'",
      githubCommentId,
      id,
    );
    if (cursor.rowsWritten !== 1) {
      throw new Error("Publication was not in publishing state");
    }
  }

  public cleanupState(
    runId: RunId,
  ): Promise<
    { readonly attempts: number; readonly state: string } | undefined
  > {
    const parsedRunId = runIdSchema.parse(runId);
    const row = this.ctx.storage.sql
      .exec<CleanupRow>(
        "SELECT run_id, state, attempts FROM cleanup_tasks WHERE run_id = ?",
        parsedRunId,
      )
      .toArray()[0];
    return Promise.resolve(
      row === undefined
        ? undefined
        : { attempts: row.attempts, state: row.state },
    );
  }

  public async completeWorkflowSupersession(
    runId: RunId,
    completedAt: string,
  ): Promise<void> {
    const parsedRunId = runIdSchema.parse(runId);
    const parsedCompletedAt = normalizedTimestamp(completedAt);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "UPDATE workflow_supersessions SET state = 'completed', completed_at = ? WHERE superseded_run_id = ? AND state = 'pending'",
        parsedCompletedAt,
        parsedRunId,
      );
      this.ctx.storage.sql.exec(
        "UPDATE cleanup_tasks SET next_attempt_at = ? WHERE run_id = ? AND state = 'pending' AND next_attempt_at > ?",
        parsedCompletedAt,
        parsedRunId,
        parsedCompletedAt,
      );
    });
    await this.ensureMaintenanceAlarm();
  }

  private checkReconciliation: Promise<void> | undefined;
  private async reconcileChecks(runId?: string): Promise<void> {
    // All GitHub check mutations for this PR pass through this serialized owner.
    while (this.checkReconciliation) await this.checkReconciliation;
    const pending = new CheckRunReconciliationStore(
      this.ctx.storage,
    ).processDue(this.env, new Date().toISOString(), undefined, runId);
    this.checkReconciliation = pending;
    try {
      await pending;
    } finally {
      if (this.checkReconciliation === pending)
        this.checkReconciliation = undefined;
    }
    await this.ensureMaintenanceAlarm();
  }
  public async reconcileCheckRun(runId: string): Promise<number | undefined> {
    await this.reconcileChecks(runId);
    return this.checkRunId(runId as RunId);
  }
  public async scheduleCheckRun(
    runId: string,
    desired: DesiredCheckRun,
  ): Promise<number> {
    const revision = new CheckRunReconciliationStore(this.ctx.storage).schedule(
      runId,
      desired,
    );
    await this.ensureMaintenanceAlarm();
    return revision;
  }
  public override async alarm(): Promise<void> {
    this.clarificationStore.expire();
    const startedAt = new Date();
    this.ctx.storage.sql.exec(
      "DELETE FROM run_memory_snapshots WHERE expires_at<=?",
      startedAt.toISOString(),
    );
    const cleanup = this.dueCleanup(startedAt.toISOString());

    if (cleanup !== undefined) {
      const attempt = cleanup.attempts + 1;
      try {
        await this.cleanupRepository(cleanup.run_id);
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec(
            "UPDATE cleanup_tasks SET state = 'completed', attempts = ?, completed_at = ? WHERE run_id = ? AND state = 'pending'",
            attempt,
            new Date().toISOString(),
            cleanup.run_id,
          );
          this.ctx.storage.sql.exec(
            "DELETE FROM credential_scopes WHERE run_id = ?",
            cleanup.run_id,
          );
        });
        consoleLogger.emit("repository.cleanup_completed", {
          eventId: `cleanup:${cleanup.run_id}:${attempt}`,
          runId: cleanup.run_id,
        });
      } catch (error) {
        const nextAttemptAt = new Date(
          Date.now() + maintenanceBackoff(attempt),
        ).toISOString();
        this.ctx.storage.sql.exec(
          "UPDATE cleanup_tasks SET attempts = ?, next_attempt_at = ? WHERE run_id = ? AND state = 'pending'",
          attempt,
          nextAttemptAt,
          cleanup.run_id,
        );
        consoleLogger.emit("repository.cleanup_retry", {
          attempt,
          errorKind: errorKind(error),
          eventId: `cleanup:${cleanup.run_id}:${attempt}`,
          runId: cleanup.run_id,
        });
      }
    }

    await this.deliverProjection();
    await this.deliverMemory();
    await this.reconcileChecks();
    await this.processDueWorkflowSupersession(startedAt.toISOString());

    await this.ensureMaintenanceAlarm();
  }

  public loadRunMemory(runId: string): Promise<MemorySnapshot | undefined> {
    return Promise.resolve(new RunMemoryStore(this.ctx.storage).load(runId));
  }
  public async saveRunMemory(snapshot: MemorySnapshot): Promise<void> {
    new RunMemoryStore(this.ctx.storage).save(snapshot);
    await this.ensureMaintenanceAlarm();
  }
  private async deliverMemory(): Promise<void> {
    const store = new RunMemoryStore(this.ctx.storage);
    for (const pending of store.due()) {
      try {
        const delivery = pending.delivery;
        const identity = delivery.observation.source;
        const currentName =
          await this.env.PROJECT_IDENTIFICATION_REGISTRY.getByName(
            String(identity.installationId),
          ).register(identity.installationId, identity.repositoryId);
        if (currentName === delivery.memoryName) {
          const result = memoryRecordResultSchema.parse(
            await this.env.REPOSITORY_MEMORIES.getByName(currentName).record(
              delivery.observation,
            ),
          );
          if (result === "capacity_exceeded")
            throw new Error("Repository memory capacity exceeded");
        }
        store.complete(pending.id);
      } catch {
        store.retry(pending.id, pending.attempts + 1);
      }
    }
  }

  private latestRunId(): string | undefined {
    return this.ctx.storage.sql
      .exec<{ value: string }>(
        "SELECT value FROM metadata WHERE key = 'latest_run_id'",
      )
      .toArray()[0]?.value;
  }

  private applyTransition(
    transition: ReturnType<typeof runTransitionSchema.parse>,
  ): void {
    if (!canTransitionRun(transition.expected, transition.next)) {
      throw new TypeError(
        `Invalid review run transition: ${transition.expected} -> ${transition.next}`,
      );
    }
    const sql = this.ctx.storage.sql;
    const recorded = sql
      .exec<{ expected_state: string; next_state: string; run_id: string }>(
        "SELECT run_id, expected_state, next_state FROM transition_operations WHERE operation_id = ?",
        transition.operationId,
      )
      .toArray()[0];
    if (recorded !== undefined) {
      if (
        recorded.run_id === transition.runId &&
        recorded.expected_state === transition.expected &&
        recorded.next_state === transition.next
      ) {
        return;
      }
      throw new Error(
        "Transition operation id was reused with different input",
      );
    }
    const cursor = sql.exec(
      "UPDATE runs SET state = ?, updated_at = ?, attempt = attempt + ? WHERE id = ? AND state = ?",
      transition.next,
      transition.occurredAt,
      transition.next === "running" ? 1 : 0,
      transition.runId,
      transition.expected,
    );
    if (cursor.rowsWritten !== 1) {
      throw new Error(
        `Conditional transition failed: ${transition.expected} -> ${transition.next}`,
      );
    }
    sql.exec(
      "INSERT INTO transition_operations (operation_id, run_id, expected_state, next_state) VALUES (?, ?, ?, ?)",
      transition.operationId,
      transition.runId,
      transition.expected,
      transition.next,
    );
  }

  private insertCleanup(
    runId: RunId,
    requestedAt: string,
    nextAttemptAt = requestedAt,
  ): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO cleanup_tasks (run_id, state, requested_at, next_attempt_at) VALUES (?, 'pending', ?, ?) ON CONFLICT(run_id) DO NOTHING",
      runId,
      requestedAt,
      nextAttemptAt,
    );
  }

  private insertWorkflowSupersession(
    supersededRunId: RunId,
    workflowInstanceId: string,
    supersededByRunId: RunId,
    requestedAt: string,
    nextAttemptAt: string,
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO workflow_supersessions (
         superseded_run_id, workflow_instance_id, superseded_by_run_id,
         state, requested_at, next_attempt_at
       ) VALUES (?, ?, ?, 'pending', ?, ?)
       ON CONFLICT(superseded_run_id) DO NOTHING`,
      supersededRunId,
      workflowInstanceId,
      supersededByRunId,
      requestedAt,
      nextAttemptAt,
    );
  }

  private credentialScope(runId: string): CredentialScopeRow | undefined {
    return this.ctx.storage.sql
      .exec<CredentialScopeRow>(
        "SELECT container_id, installation_id, repository_id, repository_name, repository_owner FROM credential_scopes WHERE run_id = ?",
        runId,
      )
      .toArray()[0];
  }

  private insertCredentialScope(
    request: GitHubCredentialRequest & { readonly installationId: number },
  ): boolean {
    const existing = this.credentialScope(request.runId);
    if (existing !== undefined) {
      return (
        existing.container_id === request.containerId &&
        existing.installation_id === request.installationId &&
        existing.repository_id === request.repositoryId &&
        existing.repository_name === request.repositoryName &&
        existing.repository_owner === request.repositoryOwner
      );
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO credential_scopes (run_id, installation_id, repository_id, repository_owner, repository_name, container_id) VALUES (?, ?, ?, ?, ?, ?)",
      request.runId,
      request.installationId,
      request.repositoryId,
      request.repositoryOwner,
      request.repositoryName,
      request.containerId,
    );
    return true;
  }

  private dueCleanup(now: string): CleanupRow | undefined {
    return this.ctx.storage.sql
      .exec<CleanupRow>(
        "SELECT run_id, state, attempts, next_attempt_at FROM cleanup_tasks WHERE state = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at, requested_at, run_id LIMIT 1",
        now,
      )
      .toArray()[0];
  }

  private dueWorkflowSupersession(
    now: string,
  ): WorkflowSupersessionRow | undefined {
    return this.ctx.storage.sql
      .exec<WorkflowSupersessionRow>(
        "SELECT superseded_run_id, workflow_instance_id, state, attempts, next_attempt_at FROM workflow_supersessions WHERE state = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at, requested_at, superseded_run_id LIMIT 1",
        now,
      )
      .toArray()[0];
  }

  private pendingWorkflowSupersessions(): SupersededWorkflow[] {
    return this.ctx.storage.sql
      .exec<{
        superseded_run_id: string;
        workflow_instance_id: string;
      }>(
        "SELECT superseded_run_id, workflow_instance_id FROM workflow_supersessions WHERE state = 'pending' ORDER BY requested_at, superseded_run_id LIMIT 100",
      )
      .toArray()
      .map((row) => ({
        runId: runIdSchema.parse(row.superseded_run_id),
        workflowInstanceId: row.workflow_instance_id,
      }));
  }

  private nextMaintenanceAt(): number | undefined {
    const row = this.ctx.storage.sql
      .exec<{
        next_attempt_at: string | null;
      }>(
        `SELECT
           (SELECT MIN(next_attempt_at) FROM (
             SELECT next_attempt_at FROM cleanup_tasks WHERE state = 'pending'
             UNION ALL
             SELECT next_attempt_at FROM workflow_supersessions WHERE state = 'pending'
             UNION ALL
             SELECT expires_at AS next_attempt_at FROM run_memory_snapshots
             UNION ALL
             SELECT next_attempt_at FROM memory_outbox
             UNION ALL
             SELECT next_attempt_at FROM check_run_tasks WHERE revision > completed_revision
           )) AS next_attempt_at`,
      )
      .toArray()[0];
    if (row === undefined) {
      return undefined;
    }

    const projectionAt = this.ctx.storage.sql
      .exec<{ next_attempt_at: string | null }>(
        "SELECT MIN(next_attempt_at) AS next_attempt_at FROM review_projection_task",
      )
      .toArray()[0]?.next_attempt_at;
    const candidates = [
      projectionAt ? Date.parse(projectionAt) : undefined,
      this.clarificationStore.nextExpiration(),
      row.next_attempt_at === null
        ? undefined
        : Date.parse(row.next_attempt_at),
    ].filter((candidate): candidate is number =>
      candidate === undefined ? false : Number.isFinite(candidate),
    );
    if (candidates.length === 0) return undefined;
    return Math.max(Date.now(), Math.min(...candidates));
  }

  private async ensureMaintenanceAlarm(): Promise<void> {
    const next = this.nextMaintenanceAt();
    if (next === undefined) return;
    try {
      const scheduled = await this.ctx.storage.getAlarm();
      if (scheduled === null || scheduled > next) {
        await this.ctx.storage.setAlarm(next);
      }
      consoleLogger.emit("dashboard.alarm_health", { code: 0 });
    } catch (error) {
      consoleLogger.emit("dashboard.alarm_health", { code: 1 });
      throw error;
    }
  }

  private async cleanupRepository(runId: string): Promise<void> {
    new RunConfigurationStore(this.ctx.storage).cleanup(runId);
    const startedAt = Date.now();
    let outcome = "failed";
    try {
      await this.env.REPOSITORY_EXECUTOR.cleanup(runId);
      outcome = "completed";
    } finally {
      try {
        consoleLogger.emit("repository.cleanup_finished", {
          runId,
          outcome,
          durationMs: Date.now() - startedAt,
        });
      } catch {
        /* Cleanup remains authoritative when logging fails. */
      }
    }
    this.ctx.storage.sql.exec(
      "DELETE FROM review_analysis_artifacts WHERE run_id = ?",
      runId,
    );
  }

  public async saveRunConfiguration(
    snapshot: RunConfigurationSnapshot,
  ): Promise<RunConfigurationRef> {
    return await new RunConfigurationStore(this.ctx.storage).save(snapshot);
  }
  public async loadRunConfiguration(
    reference: RunConfigurationRef,
  ): Promise<RunConfigurationSnapshot> {
    return await new RunConfigurationStore(this.ctx.storage).load(reference);
  }
  public findRunConfiguration(
    runId: string,
  ): Promise<RunConfigurationRef | undefined> {
    return Promise.resolve(
      new RunConfigurationStore(this.ctx.storage).reference(
        runIdSchema.parse(runId),
      ),
    );
  }

  public async saveReviewAnalysis(
    runId: string,
    output: ReconciledReviewOutput,
  ): Promise<ReviewAnalysisCheckpoint> {
    const store = new RunMemoryStore(this.ctx.storage);
    const validated = memoryReviewOutputSchema.parse(output);
    const result = await this.mutateReadModel(() => {
      const checkpoint = new ReviewAnalysisStore(this.ctx.storage).save(
        runId,
        validated,
      );
      new ReviewReadModel(this.ctx.storage).saveDetail(runId, validated);
      const snapshot = store.load(runId);
      if (snapshot) {
        for (const finding of validated.activeFindings.filter((candidate) =>
          validated.updatedTrackedFindings.some(
            (tracked) =>
              tracked.fingerprint === candidate.fingerprint &&
              tracked.lastSeenRunId === runId &&
              tracked.lastSeenHeadSha === snapshot.identity.headSha,
          ),
        ))
          store.enqueue(snapshot, {
            id: `finding:${runId}:${finding.fingerprint}`,
            kind: "finding",
            path: finding.location.path,
            line: finding.location.line,
            summary: finding.diagnostic.slice(0, 1500),
            fingerprint: finding.fingerprint,
            createdAt: snapshot.capturedAt,
          });
        for (const [index, investigation] of (
          validated.investigations ?? []
        ).entries())
          store.enqueue(snapshot, {
            id: `investigation:${runId}:${index}`,
            kind: "investigation",
            path: investigation.path,
            line: investigation.line,
            summary: investigation.summary,
            createdAt: snapshot.capturedAt,
          });
      }
      return checkpoint;
    }, this.runActivityAt(runId));
    await this.ensureMaintenanceAlarm();
    return result;
  }

  public loadReviewAnalysis(runId: string): Promise<ReconciledReviewOutput> {
    return Promise.resolve(
      new ReviewAnalysisStore(this.ctx.storage).load(runId),
    );
  }

  public configureReviewBudget(
    rawRunId: string,
    plan: ReviewBudgetPlan,
  ): Promise<void> {
    const runId = runIdSchema.parse(rawRunId);
    this.ctx.storage.transactionSync(() => {
      if (
        this.latestRunId() !== runId ||
        this.runState(runId as RunId) !== "running"
      )
        throw new Error("Review budget run is not authorized");
      new ReviewBudgetPlanStore(this.ctx.storage.sql).configure(runId, plan);
    });
    return Promise.resolve();
  }
  public completeReviewBudgetShard(
    rawRunId: string,
    index: number,
  ): Promise<void> {
    const runId = runIdSchema.parse(rawRunId);
    this.ctx.storage.transactionSync(() => {
      const budget = new ReviewBudgetPlanStore(this.ctx.storage.sql);
      // A replay of a persisted completion has no effect even after publishing.
      if (budget.isComplete(runId, index)) return;
      if (
        this.latestRunId() !== runId ||
        this.runState(runId as RunId) !== "running"
      )
        throw new Error("Review budget run is not authorized");
      budget.complete(runId, index);
    });
    return Promise.resolve();
  }

  public reserveModelGeneration(
    runId: string,
    request: ModelGenerationReservation,
  ): Promise<ModelGenerationAdmission | undefined> {
    return Promise.resolve(
      this.ctx.storage.transactionSync(() => {
        if (
          this.latestRunId() !== runId ||
          this.runState(runId as RunId) !== "running"
        )
          return undefined;
        return new ReviewGenerationBudgetStore(this.ctx.storage.sql).reserve(
          runId,
          request,
        );
      }),
    );
  }
  public loadModelGenerationStop(
    rawRunId: string,
  ): Promise<ModelGenerationStopReason | undefined> {
    const runId = runIdSchema.parse(rawRunId);
    return Promise.resolve(
      this.ctx.storage.transactionSync(() => {
        if (
          this.latestRunId() !== runId ||
          this.runState(runId as RunId) !== "running"
        )
          throw new Error("Model budget run is not authorized");
        return new ReviewGenerationBudgetStore(
          this.ctx.storage.sql,
        ).loadStopReason(runId);
      }),
    );
  }
  public settleModelGeneration(
    runId: string,
    id: number,
    outputTokens: number,
  ): Promise<void> {
    this.ctx.storage.transactionSync(() =>
      new ReviewGenerationBudgetStore(this.ctx.storage.sql).settle(
        runId,
        id,
        outputTokens,
      ),
    );
    return Promise.resolve();
  }

  public reserveAnalysisToolCall(
    runId: string,
    index: number,
    totalShards: number,
  ): Promise<boolean> {
    return Promise.resolve(
      this.ctx.storage.transactionSync(() => {
        if (
          this.latestRunId() !== runId ||
          this.runState(runId as RunId) !== "running"
        )
          return false;
        return new ReviewToolBudgetStore(this.ctx.storage.sql).reserveToolCall(
          runId,
          index,
          totalShards,
        );
      }),
    );
  }

  private async terminateSupersededWorkflow(
    workflowInstanceId: string,
  ): Promise<void> {
    await terminateWorkflowIfActive(
      this.env.REVIEW_WORKFLOW,
      workflowInstanceId,
    );
  }

  private async processDueWorkflowSupersession(now: string): Promise<void> {
    const supersession = this.dueWorkflowSupersession(now);
    if (supersession === undefined) return;

    const attempt = supersession.attempts + 1;
    try {
      await this.terminateSupersededWorkflow(supersession.workflow_instance_id);
      this.ctx.storage.sql.exec(
        "UPDATE workflow_supersessions SET state = 'completed', attempts = ?, completed_at = ? WHERE superseded_run_id = ? AND state = 'pending'",
        attempt,
        new Date().toISOString(),
        supersession.superseded_run_id,
      );
      consoleLogger.emit("workflow.supersession_completed", {
        attempt,
        eventId: `supersession:${supersession.superseded_run_id}:${attempt}`,
        runId: supersession.superseded_run_id,
      });
    } catch (error) {
      const nextAttemptAt = new Date(
        Date.now() + maintenanceBackoff(attempt),
      ).toISOString();
      this.ctx.storage.sql.exec(
        "UPDATE workflow_supersessions SET attempts = ?, next_attempt_at = ? WHERE superseded_run_id = ? AND state = 'pending'",
        attempt,
        nextAttemptAt,
        supersession.superseded_run_id,
      );
      consoleLogger.emit("workflow.supersession_retry", {
        attempt,
        errorKind: errorKind(error),
        eventId: `supersession:${supersession.superseded_run_id}:${attempt}`,
        runId: supersession.superseded_run_id,
      });
    }
  }

  public loadPrFindings(prKey: PrKey): Promise<readonly TrackedFinding[]> {
    return Promise.resolve(this.findingStore.loadPrFindings(prKey));
  }

  public async admitClarification(input: ClarificationAdmission) {
    const record = this.clarificationStore.admit(input);
    await this.ensureMaintenanceAlarm();
    return record;
  }
  public async loadClarification(id: number) {
    return this.clarificationStore.load(id);
  }
  public async clarificationHistory(id: number) {
    return this.clarificationStore.history(id);
  }
  public async isClarificationAuthorized(id: number) {
    return this.clarificationStore.authorized(id);
  }
  public async reserveClarificationRead(id: number) {
    return this.clarificationStore.reserveRead(id);
  }
  public async recordClarificationRead(id: number, read: ClarificationRead) {
    return this.clarificationStore.recordRead(id, read);
  }
  public async reserveClarificationGeneration(
    id: number,
    request: Omit<ModelGenerationReservation, "shardIndex" | "shardCount">,
  ) {
    return this.clarificationStore.reserveGeneration(id, request);
  }
  public async settleClarificationGeneration(
    id: number,
    reservationId: number,
    outputTokens: number,
  ) {
    this.clarificationStore.settleGeneration(id, reservationId, outputTokens);
  }
  public async answerClarification(id: number, answer: unknown) {
    const result = await this.mutateReadModel(
      () => this.clarificationStore.answer(id, answer),
      new Date().toISOString(),
    );
    await this.ensureMaintenanceAlarm();
    return result;
  }
  public async canPublishClarification(id: number) {
    return this.clarificationStore.canPublish(id);
  }
  public async completeClarification(id: number, replyCommentId?: number) {
    this.clarificationStore.complete(id, replyCommentId);
  }

  public async savePrFindings(
    prKey: PrKey,
    findings: readonly TrackedFinding[],
    writerRunId: RunId,
  ): Promise<void> {
    await this.mutateReadModel(
      () => this.findingStore.savePrFindings(prKey, findings, writerRunId),
      this.runActivityAt(writerRunId),
    );
  }

  public findFindingByCommentId(
    prKey: PrKey,
    commentId: number,
  ): Promise<TrackedFinding | undefined> {
    return Promise.resolve(
      this.findingStore.findFindingByCommentId(prKey, commentId),
    );
  }

  public recordFindingFeedback(
    prKey: PrKey,
    feedback: FindingFeedbackRecord,
  ): Promise<void> {
    this.findingStore.recordFindingFeedback(prKey, feedback);
    return Promise.resolve();
  }

  public loadFindingFeedbacks(
    prKey: PrKey,
    fingerprint?: FindingFingerprint,
  ): Promise<readonly FindingFeedbackRecord[]> {
    return Promise.resolve(
      this.findingStore.loadFindingFeedbacks(prKey, fingerprint),
    );
  }

  public async recordReviewDecision(
    runId: RunId,
    decision: Omit<ReviewDecisionContext, "checkRunId" | "runId">,
  ): Promise<void> {
    await this.mutateReadModel(
      () => this.findingStore.recordReviewDecision(runId, decision),
      this.runActivityAt(runId),
    );
  }

  public loadLatestReviewDecision(
    prKey: PrKey,
  ): Promise<ReviewDecisionContext | undefined> {
    return Promise.resolve(this.findingStore.loadLatestReviewDecision(prKey));
  }

  public hasPriorPublishedReview(rawRunId: string): Promise<boolean> {
    const runId = runIdSchema.parse(rawRunId);
    const row = this.ctx.storage.sql
      .exec<{ present: number }>(
        `SELECT 1 AS present
         FROM publications AS publication
         JOIN runs AS run ON run.id = publication.run_id
         JOIN runs AS current_run ON current_run.id = ?
         WHERE run.pr_key = current_run.pr_key AND publication.run_id <> current_run.id
           AND publication.kind = 'summary' AND publication.state = 'published'
         LIMIT 1`,
        runId,
      )
      .toArray()[0];
    return Promise.resolve(row !== undefined);
  }

  public async applyFindingFeedback(
    input: ApplyFindingFeedbackInput,
  ): Promise<AppliedFindingFeedback> {
    const result = await this.mutateReadModel(() => {
      const applied = this.findingStore.applyFindingFeedback(input);
      if (applied.feedback && applied.outcome === "applied") {
        const store = new RunMemoryStore(this.ctx.storage);
        const finding = this.findingStore.findFindingByCommentId(
          input.prKey,
          input.targetCommentId,
        );
        const snapshot = finding
          ? store.source(finding.lastSeenRunId)
          : undefined;
        if (snapshot && finding)
          store.enqueue(snapshot, {
            id: `feedback:${input.githubCommentId}`,
            kind: "feedback",
            path: finding.filePath,
            line: finding.line,
            summary: input.reason ?? finding.diagnostic.slice(0, 1500),
            ...(input.reason ? { feedbackReason: input.reason } : {}),
            createdAt: input.createdAt,
            authorLogin: input.authorLogin,
            commentId: input.githubCommentId,
            label: input.label,
            fingerprint: finding.fingerprint,
          });
      }
      return applied;
    }, input.createdAt);
    await this.ensureMaintenanceAlarm();
    return result;
  }

  public completeFeedbackReply(
    deliveryId: string,
    replyCommentId: number,
  ): Promise<void> {
    this.findingStore.completeFeedbackReply(deliveryId, replyCommentId);
    return Promise.resolve();
  }

  public async saveProjectIdentification(
    runId: string,
    raw: ProjectIdentificationResult,
  ): Promise<void> {
    const result = projectIdentificationResultSchema.parse(raw);
    if (
      !runIdSchema
        .parse(runId)
        .includes(":head:" + result.snapshotSha + ":base:")
    )
      throw new Error("Identification snapshot mismatch");
    const exists = this.ctx.storage.sql
      .exec<{ id: string }>("SELECT id FROM runs WHERE id=?", runId)
      .toArray()[0];
    if (!exists) throw new Error("Identification run unavailable");
    const key = "project-identification:" + runId;
    const existing =
      await this.ctx.storage.get<ProjectIdentificationResult>(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(result))
      throw new Error("Identification snapshot already recorded");
    await this.ctx.storage.put(key, result);
  }
}
