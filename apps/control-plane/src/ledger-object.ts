import type {
  AppliedFindingFeedback,
  ApplyFindingFeedbackInput,
  ClaimedPublication,
  FeedbackLedger,
  ReviewDecisionContext,
  ReviewLedger,
} from "@holon/application";
import {
  githubCredentialRequestSchema,
  positiveIntegerSchema,
  publicationIdSchema,
  publicationRecordSchema,
  runClaimSchema,
  runIdSchema,
  runStateSchema,
  runTelemetrySchema,
  runTransitionSchema,
  timestampSchema,
  type FindingFeedbackRecord,
  type GitHubCredentialRequest,
  type RunTelemetry,
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
import { canTransitionRun } from "@holon/domain";
import { DurableObject } from "cloudflare:workers";

import { FindingLedgerStore } from "./finding-ledger-store.js";
import { applyLedgerMigrations } from "./ledger-migrations.js";
import { consoleLogger, errorKind } from "./observability.js";

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
  run_id: string;
  state: string;
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
      if (
        this.pendingCleanup() !== undefined &&
        (await this.ctx.storage.getAlarm()) === null
      ) {
        await this.ctx.storage.setAlarm(Date.now());
      }
    });
  }

  public claimRun(
    rawRun: ReviewRun,
    rawWorkflowInstanceId: string,
    rawCausalVersion?: string,
  ): Promise<"claimed" | "duplicate" | "resume"> {
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
      return Promise.resolve(
        isOwnedActiveRun && this.latestRunId() === run.id
          ? "resume"
          : "duplicate",
      );
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
    return Promise.resolve(outcome);
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
    await this.ensureCleanupAlarm();
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
    if (requiresCleanup) await this.ensureCleanupAlarm();
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

  public override async alarm(): Promise<void> {
    const task = this.pendingCleanup();
    if (task === undefined) return;
    try {
      await this.cleanupRepository(task.run_id);
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "UPDATE cleanup_tasks SET state = 'completed', attempts = attempts + 1, completed_at = ? WHERE run_id = ? AND state = 'pending'",
          new Date().toISOString(),
          task.run_id,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM credential_scopes WHERE run_id = ?",
          task.run_id,
        );
      });
      consoleLogger.emit("repository.cleanup_completed", {
        eventId: `cleanup:${task.run_id}:${task.attempts + 1}`,
        runId: task.run_id,
      });
      await this.ensureCleanupAlarm();
    } catch (error) {
      const attempts = task.attempts + 1;
      this.ctx.storage.sql.exec(
        "UPDATE cleanup_tasks SET attempts = ? WHERE run_id = ? AND state = 'pending'",
        attempts,
        task.run_id,
      );
      consoleLogger.emit("repository.cleanup_retry", {
        attempt: attempts,
        errorKind: errorKind(error),
        eventId: `cleanup:${task.run_id}:${attempts}`,
        runId: task.run_id,
      });
      const delay = Math.min(
        60 * 60_000,
        5_000 * 2 ** Math.min(attempts - 1, 9),
      );
      await this.ctx.storage.setAlarm(Date.now() + delay);
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

  private insertCleanup(runId: RunId, requestedAt: string): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO cleanup_tasks (run_id, state, requested_at) VALUES (?, 'pending', ?) ON CONFLICT(run_id) DO NOTHING",
      runId,
      requestedAt,
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

  private pendingCleanup(): CleanupRow | undefined {
    return this.ctx.storage.sql
      .exec<CleanupRow>(
        "SELECT run_id, state, attempts FROM cleanup_tasks WHERE state = 'pending' ORDER BY requested_at, run_id LIMIT 1",
      )
      .toArray()[0];
  }

  private async ensureCleanupAlarm(): Promise<void> {
    if (
      this.pendingCleanup() !== undefined &&
      (await this.ctx.storage.getAlarm()) === null
    ) {
      await this.ctx.storage.setAlarm(Date.now());
    }
  }

  private async cleanupRepository(runId: string): Promise<void> {
    await this.env.REPOSITORY_EXECUTOR.cleanup(runId);
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
    evidence: { readonly markdown: string; readonly workflowRunId?: number },
  ): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO ci_evidences (
           pr_key, head_sha, markdown_content, workflow_run_id, created_at
         ) VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
        prKey,
        headSha,
        evidence.markdown,
        evidence.workflowRunId ?? null,
      );
    });
    return Promise.resolve();
  }

  public loadCiEvidence(
    prKey: PrKey,
    headSha: string,
  ): Promise<
    | { readonly markdown: string; readonly workflowRunId?: number | undefined }
    | undefined
  > {
    const rows = this.ctx.storage.sql
      .exec<{
        markdown_content: string;
        workflow_run_id: number | null;
      }>(
        `SELECT markdown_content, workflow_run_id FROM ci_evidences WHERE pr_key = ? AND head_sha = ?`,
        prKey,
        headSha,
      )
      .toArray();
    const first = rows[0];
    if (!first) return Promise.resolve(undefined);
    return Promise.resolve({
      markdown: first.markdown_content,
      ...(first.workflow_run_id !== null
        ? { workflowRunId: first.workflow_run_id }
        : {}),
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
           verdict, is_degraded, step_timings_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        parsed.scopeStatus,
        parsed.terminalState,
        parsed.verdict ?? null,
        parsed.isDegraded ? 1 : 0,
        JSON.stringify(parsed.stepTimings),
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
}

interface RunTelemetryRow extends Record<string, SqlStorageValue> {
  created_at: string;
  duration_ms: number;
  estimated_cost_micro_usd: number;
  estimated_cost_usd: number;
  head_sha: string;
  input_tokens: number;
  is_degraded: number;
  output_tokens: number;
  pricing_model: string;
  pr_key: string;
  queue_wait_ms: number;
  reasoning_tokens: number | null;
  run_id: string;
  scope_status: string;
  shards_count: number;
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
    headSha: row.head_sha,
    isDegraded: Boolean(row.is_degraded),
    prKey: row.pr_key,
    queueWaitMs: row.queue_wait_ms,
    runId: row.run_id,
    scopeStatus: row.scope_status,
    shardsCount: row.shards_count,
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
