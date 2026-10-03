import type {
  AppliedFindingFeedback,
  ApplyFindingFeedbackInput,
  ClaimedPublication,
  FeedbackLedger,
  ReviewDecisionContext,
  ReviewLedger,
} from "@holon/application";
import type {
  ModelGenerationReservation,
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
import { canTransitionRun } from "@holon/domain";
import { DurableObject } from "cloudflare:workers";

import {
  CheckRunReconciliationStore,
  type DesiredCheckRun,
} from "./check-run-reconciliation.js";
import { FindingLedgerStore } from "./finding-ledger-store.js";
import { applyLedgerMigrations } from "./ledger-migrations.js";
import { consoleLogger, errorKind } from "./observability.js";
import { ReviewAnalysisStore } from "./review-analysis-store.js";
import { ReviewGenerationBudgetStore } from "./review-generation-budget-store.js";
import { ReviewToolBudgetStore } from "./review-tool-budget-store.js";
import { RunConfigurationStore } from "./run-configuration-store.js";
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

    await this.reconcileChecks();
    await this.processDueWorkflowSupersession(startedAt.toISOString());

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
             SELECT next_attempt_at FROM check_run_tasks WHERE revision > completed_revision
           )) AS next_attempt_at`,
      )
      .toArray()[0];
    if (row === undefined) {
      return undefined;
    }

    const candidates = [
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

  public savePrFindings(
    prKey: PrKey,
    findings: readonly TrackedFinding[],
    writerRunId: RunId,
  ): Promise<void> {
    this.findingStore.savePrFindings(prKey, findings, writerRunId);
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
