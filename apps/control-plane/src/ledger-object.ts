import type {
  AppliedFindingFeedback,
  ApplyFindingFeedbackInput,
  ClaimedPublication,
  FeedbackLedger,
  ReviewDecisionContext,
  ReviewLedger,
} from "@holon/application";
import {
  projectIdentificationResultV1Schema,
  type ProjectIdentificationResultV1,
} from "@holon/contracts";
import {
  adminCiSummaryV1Schema,
  adminFindingSummaryV1Schema,
  adminRunDetailV2Schema,
  adminRunProjectionEventV1Schema,
  githubCredentialRequestSchema,
  positiveIntegerSchema,
  publicationIdSchema,
  publicationRecordSchema,
  runClaimSchema,
  runClaimV2ResultSchema,
  runIdSchema,
  runStateSchema,
  runTelemetrySchema,
  runTransitionSchema,
  timestampSchema,
  limitReviewText,
  reviewTextLimits,
  type AdminCiSummaryV1,
  type AdminRunDetailV2,
  type AdminRunProjectionEventV1,
  type FindingFeedbackRecord,
  type GitHubCredentialRequest,
  type RunTelemetry,
  type RunClaimV2Result,
  type SupersededWorkflow,
  type TrackedFinding,
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
import { DurableObject } from "cloudflare:workers";

import { FindingLedgerStore } from "./finding-ledger-store.js";
import { applyLedgerMigrations } from "./ledger-migrations.js";
import { consoleLogger, errorKind } from "./observability.js";
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
    rawCausalVersion?: string,
  ): Promise<"claimed" | "duplicate" | "resume"> {
    const result = this.claimRunInternal(
      rawRun,
      rawWorkflowInstanceId,
      rawCausalVersion,
    );
    if (result.supersededWorkflows.length > 0) {
      await this.ensureMaintenanceAlarm();
    }
    return result.outcome;
  }

  public async claimRunV2(
    rawRun: ReviewRun,
    rawWorkflowInstanceId: string,
    rawCausalVersion?: string,
  ): Promise<RunClaimV2Result> {
    const result = runClaimV2ResultSchema.parse(
      this.claimRunInternal(rawRun, rawWorkflowInstanceId, rawCausalVersion),
    );
    if (result.supersededWorkflows.length > 0) {
      await this.ensureMaintenanceAlarm();
    }
    return result;
  }

  private claimRunInternal(
    rawRun: ReviewRun,
    rawWorkflowInstanceId: string,
    rawCausalVersion?: string,
  ): RunClaimV2Result {
    const { run, workflowInstanceId } = runClaimSchema.parse({
      run: rawRun,
      workflowInstanceId: rawWorkflowInstanceId,
    });
    const causalVersion = normalizedTimestamp(
      rawCausalVersion ?? run.causalVersion ?? run.createdAt,
    );
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
    if (request.installationId === undefined) {
      throw new TypeError("Credential scope is invalid");
    }
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

  public bootstrapCredentialScope(
    raw: GitHubCredentialRequest,
  ): Promise<boolean> {
    const request = githubCredentialRequestSchema.parse(raw);
    if (request.installationId === undefined) {
      return Promise.resolve(false);
    }
    const installationId = request.installationId;
    let authorized = false;
    this.ctx.storage.transactionSync(() => {
      authorized =
        this.latestRunId() === request.runId &&
        ["running", "publishing"].includes(
          this.runState(request.runId as RunId) ?? "",
        ) &&
        this.insertCredentialScope({
          ...request,
          installationId,
        });
    });
    return Promise.resolve(authorized);
  }

  public canBootstrapCredentialScope(
    raw: GitHubCredentialRequest,
  ): Promise<boolean> {
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
    const existing = this.credentialScope(request.runId);
    return Promise.resolve(
      existing === undefined ||
        (existing.container_id === request.containerId &&
          (request.installationId === undefined ||
            existing.installation_id === request.installationId) &&
          existing.repository_id === request.repositoryId &&
          existing.repository_name === request.repositoryName &&
          existing.repository_owner === request.repositoryOwner),
    );
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
        (request.installationId === undefined ||
          scope.installation_id === request.installationId) &&
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
    await this.env.REPOSITORY_EXECUTOR.cleanup(runId);
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
      readonly markdown: string;
      readonly workflowRunId?: number;
      readonly structuredCi?: AdminCiSummaryV1 | null | undefined;
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
        evidence.markdown,
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
        readonly markdown: string;
        readonly workflowRunId?: number | undefined;
        readonly structuredCi?: AdminCiSummaryV1 | null | undefined;
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
    let structuredCi: AdminCiSummaryV1 | null = null;
    if (first.structured_ci_json) {
      try {
        structuredCi = adminCiSummaryV1Schema.parse(
          JSON.parse(first.structured_ci_json),
        );
      } catch {
        structuredCi = null;
      }
    }
    return Promise.resolve({
      markdown: first.markdown_content,
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
    rawEvent: AdminRunProjectionEventV1,
  ): Promise<void> {
    const event = adminRunProjectionEventV1Schema.parse(rawEvent);
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
    raw: ProjectIdentificationResultV1,
  ): Promise<void> {
    const result = projectIdentificationResultV1Schema.parse(raw);
    if (!runIdSchema.parse(runId).endsWith(":head:" + result.snapshotSha))
      throw new Error("Identification snapshot mismatch");
    const exists = this.ctx.storage.sql
      .exec<{ id: string }>("SELECT id FROM runs WHERE id=?", runId)
      .toArray()[0];
    if (!exists) throw new Error("Identification run unavailable");
    const key = "project-identification:" + runId;
    const existing =
      await this.ctx.storage.get<ProjectIdentificationResultV1>(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(result))
      throw new Error("Identification snapshot already recorded");
    await this.ctx.storage.put(key, result);
  }

  public async getSanitizedAdminRunDetailV2(
    rawRunId: string,
  ): Promise<AdminRunDetailV2 | null> {
    const runId = runIdSchema.parse(rawRunId);
    const telemetry = await this.loadRunTelemetry(runId);
    if (telemetry === undefined) return null;

    const prKey = derivePrKeyFromRunId(runId);
    const findingRows = this.ctx.storage.sql
      .exec<{
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
        `SELECT diagnostic, file_path, fingerprint, line, severity, status, updated_at
         FROM pr_findings
         WHERE pr_key = ?
         ORDER BY updated_at DESC, fingerprint ASC
         LIMIT 100`,
        prKey,
      )
      .toArray();

    const currentFindings = findingRows.map((row) =>
      adminFindingSummaryV1Schema.parse({
        diagnostic: sanitizeDiagnostic(row.diagnostic),
        filePath: row.file_path,
        fingerprint: row.fingerprint,
        line: row.line,
        severity: row.severity,
        status: row.status,
        updatedAt: row.updated_at,
      }),
    );

    const ciEvidence = await this.loadCiEvidence(prKey, telemetry.headSha);
    const structuredCi = ciEvidence?.structuredCi ?? null;

    return adminRunDetailV2Schema.parse({
      currentFindings,
      findingsPerspective: "current_pr_state",
      projectIdentification:
        (await this.ctx.storage.get("project-identification:" + runId)) ?? null,
      run: {
        cost: telemetry.cost,
        headSha: telemetry.headSha,
        isDegraded: telemetry.isDegraded,
        prKey: telemetry.prKey,
        runId: telemetry.runId,
        scopeStatus: telemetry.scopeStatus,
        shardsCount: telemetry.shardsCount,
        stepTimings: telemetry.stepTimings,
        terminalState: telemetry.terminalState,
        tokens: telemetry.tokens,
        toolCallsCount: telemetry.toolCallsCount,
        verdict: telemetry.verdict ?? null,
      },
      schemaVersion: 2,
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
