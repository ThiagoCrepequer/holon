import type {
  AppliedFindingFeedback,
  ApplyFindingFeedbackInput,
  ClaimedPublication,
  FeedbackLedger,
  ReviewDecisionContext,
  ReviewLedger,
} from "@holon/application";
import {
  localizedCiMarkdownSchema,
  type LocalizedCiMarkdown,
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
  adminCiSummarySchema,
  adminCleanupTaskSummarySchema,
  adminFindingSummarySchema,
  adminRunDetailSchema,
  adminRunProjectionEventSchema,
  githubCredentialRequestSchema,
  positiveIntegerSchema,
  publicationIdSchema,
  publicationRecordSchema,
  runClaimSchema,
  runClaimResultSchema,
  runIdSchema,
  runStateSchema,
  runTelemetrySchema,
  runTransitionSchema,
  sanitizePayloadRecord,
  stepAttemptTelemetrySchema,
  stepExecutionNodeSchema,
  timestampSchema,
  limitReviewText,
  reviewTextLimits,
  type AdminCiSummary,
  type AdminRunDetail,
  type AdminRunProjectionEvent,
  type FindingFeedbackRecord,
  type GitHubCredentialRequest,
  type RunTelemetry,
  type RunClaimResult,
  type StepAttemptTelemetry,
  type StepExecutionNode,
  type SupersededWorkflow,
  type TrackedFinding,
} from "@holon/contracts";
import type { AnalysisAccounting, AnalysisUsage } from "@holon/contracts";
import type {
  ReconciledReviewOutput,
  ReviewAnalysisCheckpoint,
} from "@holon/contracts";
import type {
  FindingFingerprint,
  PrKey,
  PublicationId,
  PublicationRecord,
  ReviewRun,
  RunId,
  RunState,
} from "@holon/domain";
import { canTransitionRun, derivePrKeyFromRunId } from "@holon/domain";
import { redactSecrets } from "@holon/model";
import { consoleErrorReporter, reportError } from "@holon/observability";
import { DurableObject } from "cloudflare:workers";

import { FindingLedgerStore } from "./finding-ledger-store.js";
import { applyLedgerMigrations } from "./ledger-migrations.js";
import { consoleLogger, errorKind } from "./observability.js";
import { ReviewAccountingStore } from "./review-accounting-store.js";
import { ReviewAnalysisStore } from "./review-analysis-store.js";
import { RunConfigurationStore } from "./run-configuration-store.js";
import { terminateWorkflowIfActive } from "./workflow-superseding.js";

/* eslint-disable no-control-regex */
function sanitizeDiagnostic(raw: string): string {
  const bounded = raw.slice(0, 4096);
  const noAnsi = bounded.replaceAll(/\u001B\[[0-9;]*[a-zA-Z]/gu, "");
  const noControls = noAnsi.replaceAll(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/gu,
    " ",
  );
  const redacted = redactSecrets(noControls);
  const trimmed = redacted.trim();
  return limitReviewText(
    trimmed || "Diagnostic details unavailable",
    reviewTextLimits.diagnostic,
  );
}
/* eslint-enable no-control-regex */

export interface ProjectionTaskRow extends Record<string, SqlStorageValue> {
  attempts: number;
  completed_at: string | null;
  event_id: string;
  last_error_kind: string | null;
  lease_expires_at: string | null;
  next_attempt_at: string;
  payload_hash: string;
  payload_json: string;
  requested_at: string;
  run_id: string;
  state: string;
}

interface PublicationRow extends Record<string, SqlStorageValue> {
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

  public constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    applyLedgerMigrations(this.ctx.storage);
    this.findingStore = new FindingLedgerStore(this.ctx.storage);
    void this.ctx.blockConcurrencyWhile(async () => {
      await this.ensureMaintenanceAlarm();
    });
  }

  public async claimRun(
    rawRun: ReviewRun,
    rawWorkflowInstanceId: string,
  ): Promise<RunClaimResult> {
    const result = runClaimResultSchema.parse(
      this.claimRunInternal(rawRun, rawWorkflowInstanceId),
    );
    if (result.supersededWorkflows.length > 0) {
      await this.ensureMaintenanceAlarm();
    }
    return result;
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
    this.ctx.storage.transactionSync(() => this.applyTransition(transition));
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
    this.ctx.storage.transactionSync(() => {
      this.applyTransition(transition);
      this.insertCleanup(runId, occurredAt);
    });
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
    this.ctx.storage.transactionSync(() => {
      const cursor = this.ctx.storage.sql.exec(
        "UPDATE runs SET state = 'failed_terminal', updated_at = ? WHERE id = ? AND state IN ('queued', 'running', 'publishing', 'failed_retryable')",
        parsedOccurredAt,
        parsedRunId,
      );
      changed = cursor.rowsWritten === 1;
      if (requiresCleanup) {
        this.insertCleanup(parsedRunId as RunId, parsedOccurredAt);
      }
    });
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

  public override async alarm(): Promise<void> {
    const startedAt = new Date();
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
        reportError(consoleErrorReporter, "ledger.cleanup_failed", error, {
          component: "control-plane",
          operation: "ledger.cleanup",
          runId: cleanup.run_id,
          attempt,
          disposition: "retry",
        });
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

    await this.processDueWorkflowSupersession(startedAt.toISOString());

    await this.processDueProjection(startedAt.toISOString());

    this.pruneProjectionTasks(startedAt);

    await this.ensureMaintenanceAlarm();
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

  private dueProjectionTask(now: string): ProjectionTaskRow | undefined {
    return this.ctx.storage.sql
      .exec<ProjectionTaskRow>(
        `SELECT run_id, event_id, payload_json, payload_hash, state, attempts, requested_at, next_attempt_at, lease_expires_at, completed_at, last_error_kind
         FROM projection_tasks
         WHERE (state = 'pending' AND next_attempt_at <= ?)
            OR (state = 'processing' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
         ORDER BY next_attempt_at, requested_at, run_id LIMIT 1`,
        now,
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
        completed_at: string | null;
        exhausted_at: string | null;
        lease_expires_at: string | null;
        next_attempt_at: string | null;
      }>(
        `SELECT
           (SELECT MIN(next_attempt_at) FROM (
             SELECT next_attempt_at FROM cleanup_tasks WHERE state = 'pending'
             UNION ALL
             SELECT next_attempt_at FROM workflow_supersessions WHERE state = 'pending'
             UNION ALL
             SELECT next_attempt_at FROM projection_tasks WHERE state = 'pending'
           )) AS next_attempt_at,
           (SELECT MIN(lease_expires_at) FROM projection_tasks
             WHERE state = 'processing' AND lease_expires_at IS NOT NULL) AS lease_expires_at,
           (SELECT MIN(completed_at) FROM projection_tasks
             WHERE state = 'completed' AND completed_at IS NOT NULL) AS completed_at,
           (SELECT MIN(completed_at) FROM projection_tasks
             WHERE state = 'exhausted' AND completed_at IS NOT NULL) AS exhausted_at`,
      )
      .toArray()[0];
    if (row === undefined) {
      return undefined;
    }

    const candidates = [
      row.next_attempt_at === null
        ? undefined
        : Date.parse(row.next_attempt_at),
      row.lease_expires_at === null
        ? undefined
        : Date.parse(row.lease_expires_at),
      row.completed_at === null
        ? undefined
        : Date.parse(row.completed_at) + 7 * 86_400_000,
      row.exhausted_at === null
        ? undefined
        : Date.parse(row.exhausted_at) + 30 * 86_400_000,
    ].filter((candidate): candidate is number =>
      candidate === undefined ? false : Number.isFinite(candidate),
    );
    if (candidates.length === 0) return undefined;
    return Math.max(Date.now(), Math.min(...candidates));
  }

  private pruneProjectionTasks(now: Date): void {
    const completedBefore = new Date(
      now.getTime() - 7 * 86_400_000,
    ).toISOString();
    const exhaustedBefore = new Date(
      now.getTime() - 30 * 86_400_000,
    ).toISOString();
    this.ctx.storage.sql.exec(
      `DELETE FROM projection_tasks
       WHERE (state = 'completed' AND completed_at IS NOT NULL AND completed_at <= ?)
          OR (state = 'exhausted' AND completed_at IS NOT NULL AND completed_at <= ?)`,
      completedBefore,
      exhaustedBefore,
    );
  }

  private async ensureMaintenanceAlarm(): Promise<void> {
    const next = this.nextMaintenanceAt();
    if (next === undefined) return;
    const scheduled = await this.ctx.storage.getAlarm();
    if (scheduled === null || scheduled > next) {
      await this.ctx.storage.setAlarm(next);
    }
  }

  private async cleanupRepository(runId: string): Promise<void> {
    new RunConfigurationStore(this.ctx.storage).cleanup(runId);
    await this.env.REPOSITORY_EXECUTOR.cleanup(runId);
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

  public saveReviewAnalysis(
    runId: string,
    output: ReconciledReviewOutput,
  ): Promise<ReviewAnalysisCheckpoint> {
    return Promise.resolve(
      new ReviewAnalysisStore(this.ctx.storage).save(runId, output),
    );
  }

  public loadReviewAnalysis(runId: string): Promise<ReconciledReviewOutput> {
    return Promise.resolve(
      new ReviewAnalysisStore(this.ctx.storage).load(runId),
    );
  }

  public recordAnalysisUsage(
    runId: string,
    eventId: string,
    usage: AnalysisUsage,
  ): Promise<void> {
    new ReviewAccountingStore(this.ctx.storage.sql).record(
      runId,
      eventId,
      usage,
    );
    return Promise.resolve();
  }

  public reserveAnalysisToolCall(
    runId: string,
    index: number,
    totalShards: number,
  ): Promise<boolean> {
    return Promise.resolve(
      this.ctx.storage.transactionSync(() =>
        new ReviewAccountingStore(this.ctx.storage.sql).reserveToolCall(
          runId,
          index,
          totalShards,
        ),
      ),
    );
  }

  public loadAnalysisAccounting(runId: string): Promise<AnalysisAccounting> {
    return Promise.resolve(
      new ReviewAccountingStore(this.ctx.storage.sql).load(runId),
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
      reportError(consoleErrorReporter, "ledger.supersession_failed", error, {
        component: "control-plane",
        operation: "ledger.supersession",
        runId: supersession.superseded_run_id,
        attempt,
        disposition: "retry",
      });
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

  private async processDueProjection(now: string): Promise<void> {
    const task = this.dueProjectionTask(now);
    if (task === undefined) return;

    const leaseExpiresAt = new Date(Date.now() + 120_000).toISOString();
    const cursor = this.ctx.storage.sql.exec(
      `UPDATE projection_tasks
       SET state = 'processing',
           attempts = attempts + 1,
           lease_expires_at = ?
       WHERE run_id = ?
         AND ((state = 'pending' AND next_attempt_at <= ?)
              OR (state = 'processing' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?))`,
      leaseExpiresAt,
      task.run_id,
      now,
      now,
    );

    if (cursor.rowsWritten === 0) {
      return;
    }

    const currentAttempts = task.attempts + 1;

    try {
      const queue = (this.env as { ADMIN_PROJECTION_QUEUE?: Queue<unknown> })
        .ADMIN_PROJECTION_QUEUE;
      if (queue === undefined) {
        throw new Error("ADMIN_PROJECTION_QUEUE binding not configured");
      }
      const messageBody = JSON.parse(task.payload_json);
      await queue.send(messageBody);

      this.ctx.storage.sql.exec(
        "UPDATE projection_tasks SET state = 'completed', completed_at = ?, lease_expires_at = NULL WHERE run_id = ?",
        new Date().toISOString(),
        task.run_id,
      );
      consoleLogger.emit("admin.projection_dispatched", {
        eventId: task.event_id,
        runId: task.run_id,
      });
    } catch (error) {
      reportError(
        consoleErrorReporter,
        "ledger.projection_dispatch_failed",
        error,
        {
          component: "control-plane",
          operation: "ledger.projection_dispatch",
          runId: task.run_id,
          attempt: currentAttempts,
          disposition: currentAttempts >= 20 ? "quarantine" : "retry",
        },
      );
      const kind = errorKind(error).slice(0, 100);
      if (currentAttempts >= 20) {
        const exhaustedAt = new Date().toISOString();
        this.ctx.storage.sql.exec(
          "UPDATE projection_tasks SET state = 'exhausted', completed_at = ?, lease_expires_at = NULL, last_error_kind = ? WHERE run_id = ?",
          exhaustedAt,
          kind,
          task.run_id,
        );
        consoleLogger.emit("admin.projection_exhausted", {
          attempts: currentAttempts,
          errorKind: kind,
          runId: task.run_id,
        });
      } else {
        const nextAttemptAt = new Date(
          Date.now() + maintenanceBackoff(currentAttempts),
        ).toISOString();
        this.ctx.storage.sql.exec(
          "UPDATE projection_tasks SET state = 'pending', next_attempt_at = ?, lease_expires_at = NULL, last_error_kind = ? WHERE run_id = ?",
          nextAttemptAt,
          kind,
          task.run_id,
        );
        consoleLogger.emit("admin.projection_retry", {
          attempts: currentAttempts,
          errorKind: kind,
          nextAttemptAt,
          runId: task.run_id,
        });
      }
    }
  }

  public loadPrFindings(prKey: PrKey): Promise<readonly TrackedFinding[]> {
    return Promise.resolve(this.findingStore.loadPrFindings(prKey));
  }

  public savePrFindings(
    prKey: PrKey,
    findings: readonly TrackedFinding[],
  ): Promise<void> {
    this.findingStore.savePrFindings(prKey, findings);
    return Promise.resolve();
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

  public recordReviewDecision(
    runId: RunId,
    decision: Omit<ReviewDecisionContext, "checkRunId" | "runId">,
  ): Promise<void> {
    this.findingStore.recordReviewDecision(runId, decision);
    return Promise.resolve();
  }

  public loadLatestReviewDecision(
    prKey: PrKey,
  ): Promise<ReviewDecisionContext | undefined> {
    return Promise.resolve(this.findingStore.loadLatestReviewDecision(prKey));
  }

  public applyFindingFeedback(
    input: ApplyFindingFeedbackInput,
  ): Promise<AppliedFindingFeedback> {
    return Promise.resolve(this.findingStore.applyFindingFeedback(input));
  }

  public completeFeedbackReply(
    deliveryId: string,
    replyCommentId: number,
  ): Promise<void> {
    this.findingStore.completeFeedbackReply(deliveryId, replyCommentId);
    return Promise.resolve();
  }

  public saveCiEvidence(
    prKey: PrKey,
    headSha: string,
    evidence: {
      readonly markdownByLanguage: LocalizedCiMarkdown;
      readonly workflowRunId?: number;
      readonly structuredCi?: AdminCiSummary | null | undefined;
    },
  ): Promise<void> {
    const structuredCiJson =
      evidence.structuredCi !== undefined && evidence.structuredCi !== null
        ? JSON.stringify(evidence.structuredCi)
        : null;
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO ci_evidences (
           pr_key, head_sha, markdown_content, workflow_run_id, structured_ci_json, created_at
         ) VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
        prKey,
        headSha,
        JSON.stringify(
          localizedCiMarkdownSchema.parse(evidence.markdownByLanguage),
        ),
        evidence.workflowRunId ?? null,
        structuredCiJson,
      );
    });
    return Promise.resolve();
  }

  public loadCiEvidence(
    prKey: PrKey,
    headSha: string,
  ): Promise<
    | {
        readonly markdownByLanguage: LocalizedCiMarkdown;
        readonly workflowRunId?: number | undefined;
        readonly structuredCi?: AdminCiSummary | null | undefined;
      }
    | undefined
  > {
    const rows = this.ctx.storage.sql
      .exec<{
        markdown_content: string;
        workflow_run_id: number | null;
        structured_ci_json: string | null;
      }>(
        `SELECT markdown_content, workflow_run_id, structured_ci_json FROM ci_evidences WHERE pr_key = ? AND head_sha = ?`,
        prKey,
        headSha,
      )
      .toArray();
    const first = rows[0];
    if (!first) return Promise.resolve(undefined);
    let structuredCi: AdminCiSummary | null = null;
    if (first.structured_ci_json) {
      try {
        structuredCi = adminCiSummarySchema.parse(
          JSON.parse(first.structured_ci_json),
        );
      } catch (error) {
        reportError(consoleErrorReporter, "ledger.ci_summary_invalid", error, {
          component: "control-plane",
          operation: "ledger.read_ci_summary",
          prKey,
        });
        structuredCi = null;
      }
    }
    return Promise.resolve({
      markdownByLanguage: localizedCiMarkdownSchema.parse(
        JSON.parse(first.markdown_content),
      ),
      ...(first.workflow_run_id !== null
        ? { workflowRunId: first.workflow_run_id }
        : {}),
      structuredCi,
    });
  }

  public saveRunTelemetry(telemetry: RunTelemetry): Promise<void> {
    const parsed = runTelemetrySchema.parse(telemetry);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO run_telemetry (
           run_id, pr_key, head_sha, duration_ms, queue_wait_ms,
           input_tokens, output_tokens, reasoning_tokens,
           estimated_cost_usd, estimated_cost_micro_usd, pricing_model,
           tool_calls, shards_count, scope_status, terminal_state,
           verdict, is_degraded, step_timings_json, policy_source,
           source_digest, effective_policy_digest, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        parsed.runId,
        parsed.prKey,
        parsed.headSha,
        parsed.durationMs,
        parsed.queueWaitMs,
        parsed.tokens.inputTokens,
        parsed.tokens.outputTokens,
        parsed.tokens.reasoningTokens ?? null,
        parsed.cost.estimatedCostUsd,
        parsed.cost.estimatedCostMicroUsd,
        parsed.cost.pricingModel,
        parsed.toolCallsCount,
        parsed.shardsCount,
        parsed.scopeStatus ?? null,
        parsed.terminalState,
        parsed.verdict ?? null,
        parsed.isDegraded ? 1 : 0,
        JSON.stringify(parsed.stepTimings),
        parsed.policySource ?? null,
        parsed.sourceDigest ?? null,
        parsed.effectivePolicyDigest ?? null,
        parsed.createdAt,
      );
    });
    return Promise.resolve();
  }

  public loadRunTelemetry(runId: string): Promise<RunTelemetry | undefined> {
    const rows = this.ctx.storage.sql
      .exec<RunTelemetryRow>(
        `SELECT * FROM run_telemetry WHERE run_id = ?`,
        runId,
      )
      .toArray();
    const first = rows[0];
    if (!first) return Promise.resolve(undefined);
    return Promise.resolve(rowToRunTelemetry(first));
  }

  public async recordProjectionTask(
    rawEvent: AdminRunProjectionEvent,
  ): Promise<void> {
    const event = adminRunProjectionEventSchema.parse(rawEvent);
    const requestedAt = event.payload.projectionRequestedAt;

    this.ctx.storage.sql.exec(
      `INSERT INTO projection_tasks (
         run_id, event_id, payload_json, payload_hash, state, attempts, requested_at, next_attempt_at
       ) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)
       ON CONFLICT(run_id) DO NOTHING`,
      event.payload.runId,
      event.eventId,
      JSON.stringify(event),
      event.payloadHash,
      requestedAt,
      requestedAt,
    );

    await this.ensureMaintenanceAlarm();
  }

  public async markProjectionTaskCompleted(runId: string): Promise<void> {
    const parsedRunId = runIdSchema.parse(runId);
    this.ctx.storage.sql.exec(
      `UPDATE projection_tasks
       SET state = 'completed',
           completed_at = ?,
           lease_expires_at = NULL
       WHERE run_id = ?`,
      new Date().toISOString(),
      parsedRunId,
    );
    await this.ensureMaintenanceAlarm();
  }

  public async scheduleProjectionRetry(
    runId: string,
    rawErrorKind: string,
  ): Promise<void> {
    const parsedRunId = runIdSchema.parse(runId);
    const kind = rawErrorKind.slice(0, 100);

    const task = this.ctx.storage.sql
      .exec<ProjectionTaskRow>(
        "SELECT attempts FROM projection_tasks WHERE run_id = ?",
        parsedRunId,
      )
      .toArray()[0];

    const attempts = (task?.attempts ?? 0) + 1;
    if (attempts >= 20) {
      const exhaustedAt = new Date().toISOString();
      this.ctx.storage.sql.exec(
        `UPDATE projection_tasks
         SET state = 'exhausted',
             attempts = ?,
             completed_at = ?,
             lease_expires_at = NULL,
             last_error_kind = ?
         WHERE run_id = ?`,
        attempts,
        exhaustedAt,
        kind,
        parsedRunId,
      );
      consoleLogger.emit("admin.projection_exhausted", {
        attempts,
        errorKind: kind,
        runId: parsedRunId,
      });
    } else {
      const nextAttemptAt = new Date(
        Date.now() + maintenanceBackoff(attempts),
      ).toISOString();
      this.ctx.storage.sql.exec(
        `UPDATE projection_tasks
         SET state = 'pending',
             attempts = ?,
             lease_expires_at = NULL,
             next_attempt_at = ?,
             last_error_kind = ?
         WHERE run_id = ?`,
        attempts,
        nextAttemptAt,
        kind,
        parsedRunId,
      );
    }

    await this.ensureMaintenanceAlarm();
  }

  public getProjectionTask(
    runId: string,
  ): Promise<ProjectionTaskRow | undefined> {
    const parsedRunId = runIdSchema.parse(runId);
    const row = this.ctx.storage.sql
      .exec<ProjectionTaskRow>(
        "SELECT * FROM projection_tasks WHERE run_id = ?",
        parsedRunId,
      )
      .toArray()[0];
    return Promise.resolve(row);
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
    await this.recordAnalysisUsage(runId, "project-identification", {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      toolCallsCount: 0,
    });
  }

  public async recordStepAttemptStart(
    rawRunId: string,
    stepName: string,
    phase: "admission" | "preparation" | "analysis" | "publication" | "cleanup",
    attempt: number,
    startedAt: string,
    sanitizedInput?: Record<string, unknown> | null,
    waitBeforeRetryMs?: number | null,
    stepOrder?: number | null,
  ): Promise<void> {
    const runId = runIdSchema.parse(rawRunId);
    let validatedInput: Record<string, unknown> | null = null;
    if (sanitizedInput) {
      try {
        validatedInput = sanitizePayloadRecord(sanitizedInput);
      } catch (error) {
        reportError(consoleErrorReporter, "ledger.step_input_rejected", error, {
          component: "control-plane",
          operation: "ledger.step_input",
          runId,
          stepName,
          attempt,
        });
        validatedInput = {
          sanitized: false,
          redactedReason: "payload_rejected",
        };
      }
    }
    const inputJson = validatedInput ? JSON.stringify(validatedInput) : null;
    const resolvedStepOrder = stepOrder ?? 0;

    this.ctx.storage.transactionSync(() => {
      const existingAttempt = this.ctx.storage.sql
        .exec<{
          status: string;
          started_at: string;
        }>(
          "SELECT status, started_at FROM step_attempts WHERE run_id = ? AND step_name = ? AND attempt = ?",
          runId,
          stepName,
          attempt,
        )
        .toArray()[0];

      if (existingAttempt) {
        // Attempt already exists; do not overwrite started_at or revert completed/failed attempt to running.
        return;
      }

      const existing = this.ctx.storage.sql
        .exec<{
          status: string;
          attempts_count: number;
          sanitized_input_json: string | null;
          step_order: number;
        }>(
          "SELECT status, attempts_count, sanitized_input_json, step_order FROM step_executions WHERE run_id = ? AND step_name = ?",
          runId,
          stepName,
        )
        .toArray()[0];

      if (!existing) {
        this.ctx.storage.sql.exec(
          `INSERT INTO step_executions (
            run_id, step_name, phase, status, step_order, attempts_count, total_duration_ms,
            sanitized_input_json, first_started_at, created_at, updated_at
          ) VALUES (?, ?, ?, 'running', ?, ?, 0, ?, ?, ?, ?)`,
          runId,
          stepName,
          phase,
          resolvedStepOrder,
          attempt,
          inputJson,
          startedAt,
          startedAt,
          startedAt,
        );
      } else {
        if (existing.status === "completed") {
          // Step is already completed; do not regress status or add new running attempts.
          return;
        }
        const nextAttempts = Math.max(existing.attempts_count, attempt);
        const resolvedInput = existing.sanitized_input_json ?? inputJson;
        const finalOrder =
          existing.step_order > 0 ? existing.step_order : resolvedStepOrder;
        this.ctx.storage.sql.exec(
          "UPDATE step_executions SET status = 'running', phase = ?, step_order = ?, attempts_count = ?, updated_at = ?, sanitized_input_json = ? WHERE run_id = ? AND step_name = ?",
          phase,
          finalOrder,
          nextAttempts,
          startedAt,
          resolvedInput,
          runId,
          stepName,
        );
      }

      this.ctx.storage.sql.exec(
        `INSERT INTO step_attempts (
          run_id, step_name, attempt, status, started_at, wait_before_retry_ms
        ) VALUES (?, ?, ?, 'running', ?, ?)`,
        runId,
        stepName,
        attempt,
        startedAt,
        waitBeforeRetryMs ?? null,
      );
    });
  }

  public async recordStepAttemptComplete(
    rawRunId: string,
    stepName: string,
    attempt: number,
    endedAt: string,
    durationMs: number,
    sanitizedOutput?: Record<string, unknown> | null,
  ): Promise<void> {
    const runId = runIdSchema.parse(rawRunId);
    let validatedOutput: Record<string, unknown> | null = null;
    if (sanitizedOutput) {
      try {
        validatedOutput = sanitizePayloadRecord(sanitizedOutput);
      } catch (error) {
        reportError(
          consoleErrorReporter,
          "ledger.step_output_rejected",
          error,
          {
            component: "control-plane",
            operation: "ledger.step_output",
            runId,
            stepName,
            attempt,
          },
        );
        validatedOutput = {
          sanitized: false,
          redactedReason: "payload_rejected",
        };
      }
    }
    const outputJson = validatedOutput ? JSON.stringify(validatedOutput) : null;

    this.ctx.storage.transactionSync(() => {
      const existingAttempt = this.ctx.storage.sql
        .exec<{
          status: string;
          duration_ms: number | null;
        }>(
          "SELECT status, duration_ms FROM step_attempts WHERE run_id = ? AND step_name = ? AND attempt = ?",
          runId,
          stepName,
          attempt,
        )
        .toArray()[0];

      if (
        existingAttempt?.status === "completed" ||
        existingAttempt?.status === "failed"
      ) {
        // Attempt is already terminated. Idempotent no-op to prevent double-counting duration.
        return;
      }

      if (!existingAttempt) {
        this.ctx.storage.sql.exec(
          `INSERT INTO step_attempts (
            run_id, step_name, attempt, status, started_at, ended_at, duration_ms
          ) VALUES (?, ?, ?, 'completed', ?, ?, ?)`,
          runId,
          stepName,
          attempt,
          endedAt,
          endedAt,
          durationMs,
        );
      } else {
        this.ctx.storage.sql.exec(
          "UPDATE step_attempts SET status = 'completed', ended_at = ?, duration_ms = ? WHERE run_id = ? AND step_name = ? AND attempt = ?",
          endedAt,
          durationMs,
          runId,
          stepName,
          attempt,
        );
      }

      this.ctx.storage.sql.exec(
        `UPDATE step_executions
         SET status = 'completed',
             last_ended_at = ?,
             total_duration_ms = total_duration_ms + ?,
             sanitized_output_json = COALESCE(?, sanitized_output_json),
             updated_at = ?
         WHERE run_id = ? AND step_name = ?`,
        endedAt,
        durationMs,
        outputJson,
        endedAt,
        runId,
        stepName,
      );
    });
  }

  public async recordStepAttemptFailure(
    rawRunId: string,
    stepName: string,
    attempt: number,
    endedAt: string,
    durationMs: number,
    errorCode: string,
  ): Promise<void> {
    const runId = runIdSchema.parse(rawRunId);

    this.ctx.storage.transactionSync(() => {
      const existingAttempt = this.ctx.storage.sql
        .exec<{
          status: string;
          duration_ms: number | null;
        }>(
          "SELECT status, duration_ms FROM step_attempts WHERE run_id = ? AND step_name = ? AND attempt = ?",
          runId,
          stepName,
          attempt,
        )
        .toArray()[0];

      if (
        existingAttempt?.status === "failed" ||
        existingAttempt?.status === "completed"
      ) {
        // Attempt already terminated. Idempotent no-op to prevent double-counting duration.
        return;
      }

      if (!existingAttempt) {
        this.ctx.storage.sql.exec(
          `INSERT INTO step_attempts (
            run_id, step_name, attempt, status, started_at, ended_at, duration_ms, error_code
          ) VALUES (?, ?, ?, 'failed', ?, ?, ?, ?)`,
          runId,
          stepName,
          attempt,
          endedAt,
          endedAt,
          durationMs,
          errorCode,
        );
      } else {
        this.ctx.storage.sql.exec(
          "UPDATE step_attempts SET status = 'failed', ended_at = ?, duration_ms = ?, error_code = ? WHERE run_id = ? AND step_name = ? AND attempt = ?",
          endedAt,
          durationMs,
          errorCode,
          runId,
          stepName,
          attempt,
        );
      }

      this.ctx.storage.sql.exec(
        `UPDATE step_executions
         SET status = CASE WHEN status = 'completed' THEN 'completed' ELSE 'failed' END,
             last_ended_at = ?,
             total_duration_ms = total_duration_ms + ?,
             error_code = ?,
             updated_at = ?
         WHERE run_id = ? AND step_name = ?`,
        endedAt,
        durationMs,
        errorCode,
        endedAt,
        runId,
        stepName,
      );
    });
  }

  public async getStepExecutions(
    rawRunId: string,
  ): Promise<StepExecutionNode[]> {
    const runId = runIdSchema.parse(rawRunId);

    const stepRows = this.ctx.storage.sql
      .exec<{
        step_name: string;
        phase:
          | "admission"
          | "preparation"
          | "analysis"
          | "publication"
          | "cleanup";
        status:
          | "pending"
          | "running"
          | "completed"
          | "failed"
          | "obsolete"
          | "skipped";
        step_order: number;
        attempts_count: number;
        total_duration_ms: number;
        sanitized_input_json: string | null;
        sanitized_output_json: string | null;
        error_code: string | null;
        first_started_at: string;
        last_ended_at: string | null;
      }>(
        `SELECT step_name, phase, status, step_order, attempts_count, total_duration_ms,
                sanitized_input_json, sanitized_output_json, error_code,
                first_started_at, last_ended_at
         FROM step_executions
         WHERE run_id = ?
         ORDER BY step_order ASC, first_started_at ASC, step_name ASC`,
        runId,
      )
      .toArray();

    if (stepRows.length === 0) {
      return [];
    }

    const attemptRows = this.ctx.storage.sql
      .exec<{
        step_name: string;
        attempt: number;
        status: "running" | "completed" | "failed" | "interrupted";
        started_at: string;
        ended_at: string | null;
        duration_ms: number | null;
        wait_before_retry_ms: number | null;
        error_code: string | null;
      }>(
        `SELECT step_name, attempt, status, started_at, ended_at,
                duration_ms, wait_before_retry_ms, error_code
         FROM step_attempts
         WHERE run_id = ?
         ORDER BY step_name ASC, attempt ASC`,
        runId,
      )
      .toArray();

    const attemptsByStep = new Map<string, StepAttemptTelemetry[]>();
    for (const row of attemptRows) {
      const list = attemptsByStep.get(row.step_name) ?? [];
      list.push(
        stepAttemptTelemetrySchema.parse({
          attempt: row.attempt,
          durationMs: row.duration_ms,
          endedAt: row.ended_at,
          errorCode: row.error_code,
          startedAt: row.started_at,
          status: row.status,
          waitBeforeRetryMs: row.wait_before_retry_ms,
        }),
      );
      attemptsByStep.set(row.step_name, list);
    }

    return stepRows.map((row) =>
      stepExecutionNodeSchema.parse({
        attempts: attemptsByStep.get(row.step_name) ?? [],
        attemptsCount: row.attempts_count,
        errorCode: row.error_code,
        firstStartedAt: row.first_started_at,
        lastEndedAt: row.last_ended_at,
        phase: row.phase,
        sanitizedInput: safeJsonParse(row.sanitized_input_json),
        sanitizedOutput: safeJsonParse(row.sanitized_output_json),
        status: row.status,
        stepName: row.step_name,
        stepOrder: row.step_order,
        totalDurationMs: row.total_duration_ms,
      }),
    );
  }

  public async getSanitizedAdminRunDetail(
    rawRunId: string,
  ): Promise<AdminRunDetail | null> {
    const runId = runIdSchema.parse(rawRunId);
    const prKey = derivePrKeyFromRunId(runId);

    const runRows = this.ctx.storage.sql
      .exec<{
        id: string;
        pr_key: string;
        state: string;
        attempt: number;
        created_at: string;
        updated_at: string | null;
        decision_head_sha: string | null;
        decision_scope_status: string | null;
        decision_shards_analyzed: number | null;
        decision_total_shards: number | null;
        decision_is_degraded: number | null;
      }>(
        `SELECT id, pr_key, state, attempt, created_at, updated_at,
                decision_head_sha, decision_scope_status, decision_shards_analyzed,
                decision_total_shards, decision_is_degraded
         FROM runs
         WHERE id = ?`,
        runId,
      )
      .toArray();

    if (runRows.length === 0) {
      return null;
    }
    const runRow = runRows[0]!;

    const telemetry = await this.loadRunTelemetry(runId);

    const headSha =
      telemetry?.headSha ??
      runRow.decision_head_sha ??
      runId.split(":head:")[1]?.split(":base:")[0] ??
      "";

    const currentFindingRows = this.ctx.storage.sql
      .exec<{
        identity_ambiguous: number;
        diagnostic: string;
        file_path: string;
        fingerprint: string;
        line: number;
        severity: "critical" | "high" | "medium" | "low";
        status:
          | "new"
          | "persistent"
          | "resolved"
          | "obsolete"
          | "reintroduced"
          | "dismissed";
        updated_at: string;
      }>(
        `SELECT identity_ambiguous, diagnostic, file_path, fingerprint, line, severity, status, updated_at
         FROM pr_findings
         WHERE pr_key = ?
         ORDER BY updated_at DESC, fingerprint ASC
         LIMIT 100`,
        prKey,
      )
      .toArray();

    const currentFindings = currentFindingRows.map((row) =>
      adminFindingSummarySchema.parse({
        identityAmbiguous: row.identity_ambiguous === 1,
        diagnostic: sanitizeDiagnostic(row.diagnostic),
        filePath: row.file_path,
        fingerprint: row.fingerprint,
        line: row.line,
        severity: row.severity,
        status: row.status,
        updatedAt: row.updated_at,
      }),
    );

    const historicalRunFindings = new ReviewAnalysisStore(
      this.ctx.storage,
    ).retainedFindings(runId);

    const stepExecutions = await this.getStepExecutions(runId);

    const ciEvidence = headSha
      ? await this.loadCiEvidence(prKey, headSha)
      : null;
    const structuredCi = ciEvidence?.structuredCi ?? null;
    const projectIdentification =
      (await this.ctx.storage.get<ProjectIdentificationResult>(
        "project-identification:" + runId,
      )) ?? null;

    const cleanupRows = this.ctx.storage.sql
      .exec<{
        state: "pending" | "completed";
        attempts: number;
        requested_at: string;
        completed_at: string | null;
        next_attempt_at: string | null;
      }>(
        `SELECT state, attempts, requested_at, completed_at, next_attempt_at
         FROM cleanup_tasks
         WHERE run_id = ?`,
        runId,
      )
      .toArray();

    const cleanupTask =
      cleanupRows.length > 0
        ? adminCleanupTaskSummarySchema.parse({
            attempts: cleanupRows[0]!.attempts,
            completedAt: cleanupRows[0]!.completed_at,
            nextAttemptAt: cleanupRows[0]!.next_attempt_at,
            requestedAt: cleanupRows[0]!.requested_at,
            state: cleanupRows[0]!.state,
          })
        : null;

    const rawState = runRow.state;
    const terminalState =
      telemetry?.terminalState ??
      (rawState === "completed" ||
      rawState === "failed_terminal" ||
      rawState === "obsolete"
        ? rawState
        : null);
    const runState =
      terminalState ?? (rawState as "queued" | "running" | "publishing");

    const findingsPerspective =
      historicalRunFindings !== null
        ? currentFindings.length > 0
          ? "both"
          : "historical_run"
        : "current_pr_state";

    return adminRunDetailSchema.parse({
      configuration: new RunConfigurationStore(this.ctx.storage).summary(runId),
      cleanupTask,
      currentFindings,
      findingsPerspective,

      historicalRunFindings,
      projectIdentification,
      run: {
        cost: telemetry?.cost ?? null,
        createdAt: runRow.created_at,
        headSha,
        isDegraded: telemetry?.isDegraded ?? runRow.decision_is_degraded === 1,
        prKey,
        runId,
        runState,
        scopeStatus:
          telemetry?.scopeStatus ??
          (runRow.decision_scope_status === "in_scope" ||
          runRow.decision_scope_status === "out_of_scope"
            ? runRow.decision_scope_status
            : null),
        shardsCount:
          telemetry?.shardsCount ?? runRow.decision_total_shards ?? 1,
        stepTimings: telemetry?.stepTimings ?? [],
        terminalState,
        tokens: telemetry?.tokens ?? null,
        toolCallsCount: telemetry?.toolCallsCount ?? 0,
        updatedAt: runRow.updated_at,
        verdict: telemetry?.verdict ?? null,
      },
      stepExecutions: [...stepExecutions],
      structuredCi,
    });
  }
}

interface RunTelemetryRow extends Record<string, SqlStorageValue> {
  created_at: string;
  duration_ms: number;
  estimated_cost_micro_usd: number;
  estimated_cost_usd: number;
  effective_policy_digest: string | null;
  head_sha: string;
  input_tokens: number;
  is_degraded: number;
  output_tokens: number;
  policy_source: string | null;
  pricing_model: string;
  pr_key: string;
  queue_wait_ms: number;
  reasoning_tokens: number | null;
  run_id: string;
  scope_status: string | null;
  shards_count: number;
  source_digest: string | null;
  step_timings_json: string;
  terminal_state: string;
  tool_calls: number;
  verdict: string | null;
}

function rowToRunTelemetry(row: RunTelemetryRow): RunTelemetry {
  const stepTimings = JSON.parse(row.step_timings_json);
  return runTelemetrySchema.parse({
    cost: {
      currency: "USD",
      estimatedCostMicroUsd: row.estimated_cost_micro_usd,
      estimatedCostUsd: row.estimated_cost_usd,
      pricingModel: row.pricing_model,
    },
    createdAt: row.created_at,
    durationMs: row.duration_ms,
    ...(row.effective_policy_digest === null
      ? {}
      : { effectivePolicyDigest: row.effective_policy_digest }),
    headSha: row.head_sha,
    isDegraded: Boolean(row.is_degraded),
    ...(row.policy_source === null ? {} : { policySource: row.policy_source }),
    prKey: row.pr_key,
    queueWaitMs: row.queue_wait_ms,
    runId: row.run_id,
    scopeStatus: row.scope_status ?? null,
    shardsCount: row.shards_count,
    ...(row.source_digest === null ? {} : { sourceDigest: row.source_digest }),
    stepTimings,
    terminalState: row.terminal_state,
    tokens: {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      ...(row.reasoning_tokens !== null
        ? { reasoningTokens: row.reasoning_tokens }
        : {}),
      totalTokens:
        row.input_tokens +
        row.output_tokens +
        (row.reasoning_tokens !== null ? row.reasoning_tokens : 0),
    },
    toolCallsCount: row.tool_calls,
    ...(row.verdict !== null ? { verdict: row.verdict } : {}),
  });
}

function safeJsonParse(val: string | null): Record<string, unknown> | null {
  if (!val) return null;
  try {
    const parsed = JSON.parse(val);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
