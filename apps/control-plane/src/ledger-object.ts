import type { ClaimedPublication, ReviewLedger } from "@holon/application";
import {
  findingFeedbackRecordSchema,
  githubCredentialRequestSchema,
  positiveIntegerSchema,
  publicationIdSchema,
  publicationRecordSchema,
  runClaimSchema,
  runIdSchema,
  runStateSchema,
  runTransitionSchema,
  timestampSchema,
  trackedFindingSchema,
  type FindingFeedbackRecord,
  type GitHubCredentialRequest,
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

interface PrFindingRow extends Record<string, SqlStorageValue> {
  diagnostic: string;
  file_path: string;
  fingerprint: string;
  first_seen_head_sha: string;
  first_seen_run_id: string;
  github_comment_id: number | null;
  last_seen_head_sha: string;
  last_seen_run_id: string;
  line: number;
  pr_key: string;
  severity: string;
  status: string;
  updated_at: string;
}

function rowToTrackedFinding(row: PrFindingRow): TrackedFinding {
  return trackedFindingSchema.parse({
    diagnostic: row.diagnostic,
    filePath: row.file_path,
    fingerprint: row.fingerprint,
    firstSeenHeadSha: row.first_seen_head_sha,
    firstSeenRunId: row.first_seen_run_id,
    ...(row.github_comment_id === null
      ? {}
      : { githubCommentId: row.github_comment_id }),
    lastSeenHeadSha: row.last_seen_head_sha,
    lastSeenRunId: row.last_seen_run_id,
    line: row.line,
    prKey: row.pr_key,
    severity: row.severity,
    status: row.status,
    updatedAt: row.updated_at,
  });
}

interface FindingFeedbackRow extends Record<string, SqlStorageValue> {
  author_login: string;
  created_at: string;
  fingerprint: string;
  github_comment_id: number | null;
  id: number;
  label: string;
  pr_key: string;
  reason: string | null;
  target_severity: string | null;
}

function rowToFindingFeedbackRecord(
  row: FindingFeedbackRow,
): FindingFeedbackRecord {
  return findingFeedbackRecordSchema.parse({
    authorLogin: row.author_login,
    createdAt: row.created_at,
    fingerprint: row.fingerprint,
    ...(row.github_comment_id === null
      ? {}
      : { githubCommentId: row.github_comment_id }),
    id: row.id,
    label: row.label,
    prKey: row.pr_key,
    ...(row.reason === null ? {} : { reason: row.reason }),
    ...(row.target_severity === null
      ? {}
      : { targetSeverity: row.target_severity }),
  });
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

export class ReviewLedgerObject extends DurableObject implements ReviewLedger {
  public constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    applyLedgerMigrations(this.ctx.storage);
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
    const rows = this.ctx.storage.sql
      .exec<PrFindingRow>(
        `SELECT * FROM pr_findings WHERE pr_key = ? ORDER BY file_path, line`,
        prKey,
      )
      .toArray();
    return Promise.resolve(rows.map(rowToTrackedFinding));
  }

  public savePrFindings(
    prKey: PrKey,
    findings: readonly TrackedFinding[],
  ): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      for (const finding of findings) {
        this.ctx.storage.sql.exec(
          `INSERT INTO pr_findings (
             pr_key, fingerprint, first_seen_run_id, last_seen_run_id,
             first_seen_head_sha, last_seen_head_sha, status, severity,
             file_path, line, diagnostic, github_comment_id, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(pr_key, fingerprint) DO UPDATE SET
             last_seen_run_id = excluded.last_seen_run_id,
             last_seen_head_sha = excluded.last_seen_head_sha,
             status = excluded.status,
             severity = excluded.severity,
             file_path = excluded.file_path,
             line = excluded.line,
             diagnostic = excluded.diagnostic,
             github_comment_id = COALESCE(excluded.github_comment_id, pr_findings.github_comment_id),
             updated_at = excluded.updated_at`,
          prKey,
          finding.fingerprint,
          finding.firstSeenRunId,
          finding.lastSeenRunId,
          finding.firstSeenHeadSha,
          finding.lastSeenHeadSha,
          finding.status,
          finding.severity,
          finding.filePath,
          finding.line,
          finding.diagnostic,
          finding.githubCommentId ?? null,
          finding.updatedAt,
        );
      }
    });
    return Promise.resolve();
  }

  public findFindingByCommentId(
    prKey: PrKey,
    commentId: number,
  ): Promise<TrackedFinding | undefined> {
    const rows = this.ctx.storage.sql
      .exec<PrFindingRow>(
        `SELECT * FROM pr_findings WHERE pr_key = ? AND github_comment_id = ? LIMIT 1`,
        prKey,
        commentId,
      )
      .toArray();
    const first = rows[0];
    return Promise.resolve(first ? rowToTrackedFinding(first) : undefined);
  }

  public recordFindingFeedback(
    prKey: PrKey,
    feedback: FindingFeedbackRecord,
  ): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO finding_feedbacks (
           pr_key, fingerprint, label, author_login, reason, target_severity, github_comment_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        prKey,
        feedback.fingerprint,
        feedback.label,
        feedback.authorLogin,
        feedback.reason ?? null,
        feedback.targetSeverity ?? null,
        feedback.githubCommentId ?? null,
        feedback.createdAt,
      );
    });
    return Promise.resolve();
  }

  public loadFindingFeedbacks(
    prKey: PrKey,
    fingerprint?: FindingFingerprint,
  ): Promise<readonly FindingFeedbackRecord[]> {
    const query = fingerprint
      ? `SELECT * FROM finding_feedbacks WHERE pr_key = ? AND fingerprint = ? ORDER BY created_at ASC`
      : `SELECT * FROM finding_feedbacks WHERE pr_key = ? ORDER BY created_at ASC`;
    const params = fingerprint ? [prKey, fingerprint] : [prKey];
    const rows = this.ctx.storage.sql
      .exec<FindingFeedbackRow>(query, ...params)
      .toArray();
    return Promise.resolve(rows.map(rowToFindingFeedbackRecord));
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
}
