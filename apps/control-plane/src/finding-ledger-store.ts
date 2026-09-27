import type {
  AppliedFindingFeedback,
  ApplyFindingFeedbackInput,
  ReviewDecisionContext,
} from "@holon/application";
import {
  findingFeedbackRecordSchema,
  gitShaSchema,
  positiveIntegerSchema,
  reviewScopeStatusSchema,
  reviewOutputPreferencesSchema,
  runIdSchema,
  trackedFindingSchema,
  type FindingFeedbackRecord,
  type TrackedFinding,
} from "@holon/contracts";
import {
  applyFeedbackToFindings,
  type FindingFingerprint,
  type PrKey,
  type RunId,
} from "@holon/domain";

interface PrFindingRow extends Record<string, SqlStorageValue> {
  identity_ambiguous: number;
  evidence_fingerprint: string;
  confidence: number;
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

interface FindingFeedbackRow extends Record<string, SqlStorageValue> {
  author_association: string | null;
  author_login: string;
  created_at: string;
  delivery_id: string | null;
  fingerprint: string;
  github_comment_id: number | null;
  id: number;
  label: string;
  pr_key: string;
  reason: string | null;
  reply_comment_id: number | null;
  target_severity: string | null;
}

interface ReviewDecisionRow extends Record<string, SqlStorageValue> {
  decision_output_json: string | null;
  decision_medium_threshold: number | null;
  decision_head_sha: string | null;
  decision_is_degraded: number | null;
  decision_scope_status: string | null;
  decision_shards_analyzed: number | null;
  decision_total_shards: number | null;
  github_check_run_id: number | null;
  id: string;
}

function rowToTrackedFinding(row: PrFindingRow): TrackedFinding {
  return trackedFindingSchema.parse({
    ...(row.identity_ambiguous === 1 ? { identityAmbiguous: true } : {}),
    evidenceFingerprint: row.evidence_fingerprint,
    confidence: row.confidence,
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

function rowToFindingFeedbackRecord(
  row: FindingFeedbackRow,
): FindingFeedbackRecord {
  return findingFeedbackRecordSchema.parse({
    ...(row.author_association === null
      ? {}
      : { authorAssociation: row.author_association }),
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

function validateDeliveryId(deliveryId: string): string {
  if (!/^github:[A-Za-z0-9._:-]+$/u.test(deliveryId)) {
    throw new TypeError("deliveryId has an invalid format");
  }
  return deliveryId;
}

export class FindingLedgerStore {
  public constructor(private readonly storage: DurableObjectStorage) {}

  public loadPrFindings(prKey: PrKey): readonly TrackedFinding[] {
    return this.storage.sql
      .exec<PrFindingRow>(
        "SELECT * FROM pr_findings WHERE pr_key = ? ORDER BY file_path, line",
        prKey,
      )
      .toArray()
      .map(rowToTrackedFinding);
  }

  public savePrFindings(
    prKey: PrKey,
    findings: readonly TrackedFinding[],
    writerRunId: RunId,
  ): void {
    this.storage.transactionSync(() => {
      const writer = runIdSchema.parse(writerRunId);
      const authority = this.storage.sql
        .exec<{ id: string; state: string; pr_key: string }>(
          "SELECT runs.id, runs.state, runs.pr_key FROM runs JOIN metadata ON metadata.key = 'latest_run_id' AND metadata.value = runs.id WHERE runs.id = ?",
          writer,
        )
        .toArray()[0];
      if (
        !authority ||
        authority.pr_key !== prKey ||
        authority.state !== "publishing"
      )
        throw new Error("Finding writer is no longer authoritative");
      // Feedback and machine updates share this transaction. A baseline loaded
      // before a human response must never overwrite that response on replay.
      for (const candidate of findings) {
        const finding = applyFeedbackToFindings(
          [trackedFindingSchema.parse(candidate)],
          this.loadFindingFeedbacks(prKey, candidate.fingerprint),
        )[0]!;
        this.storage.sql.exec(
          `INSERT INTO pr_findings (
             pr_key, fingerprint, first_seen_run_id, last_seen_run_id,
             first_seen_head_sha, last_seen_head_sha, status, severity,
             file_path, line, diagnostic, github_comment_id, updated_at,
             confidence, evidence_fingerprint, identity_ambiguous
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(pr_key, fingerprint) DO UPDATE SET
             last_seen_run_id = excluded.last_seen_run_id,
             last_seen_head_sha = excluded.last_seen_head_sha,
             status = excluded.status,
             severity = excluded.severity,
             file_path = excluded.file_path,
             line = excluded.line,
             diagnostic = excluded.diagnostic,
             github_comment_id = COALESCE(excluded.github_comment_id, pr_findings.github_comment_id),
             updated_at = MAX(excluded.updated_at, pr_findings.updated_at),
             confidence = excluded.confidence,
             evidence_fingerprint = excluded.evidence_fingerprint,
             identity_ambiguous = excluded.identity_ambiguous`,
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
          finding.confidence,
          finding.evidenceFingerprint,
          finding.identityAmbiguous ? 1 : 0,
        );
      }
    });
  }

  public findFindingByCommentId(
    prKey: PrKey,
    commentId: number,
  ): TrackedFinding | undefined {
    const row = this.storage.sql
      .exec<PrFindingRow>(
        "SELECT * FROM pr_findings WHERE pr_key = ? AND github_comment_id = ? LIMIT 1",
        prKey,
        positiveIntegerSchema.parse(commentId),
      )
      .toArray()[0];
    return row === undefined ? undefined : rowToTrackedFinding(row);
  }

  public recordFindingFeedback(
    prKey: PrKey,
    feedback: FindingFeedbackRecord,
  ): void {
    this.storage.sql.exec(
      `INSERT INTO finding_feedbacks (
         pr_key, fingerprint, label, author_login, reason, target_severity,
         github_comment_id, created_at, author_association
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      prKey,
      feedback.fingerprint,
      feedback.label,
      feedback.authorLogin,
      feedback.reason ?? null,
      feedback.targetSeverity ?? null,
      feedback.githubCommentId ?? null,
      feedback.createdAt,
      feedback.authorAssociation ?? null,
    );
  }

  public loadFindingFeedbacks(
    prKey: PrKey,
    fingerprint?: FindingFingerprint,
  ): readonly FindingFeedbackRecord[] {
    const query = fingerprint
      ? "SELECT * FROM finding_feedbacks WHERE pr_key = ? AND fingerprint = ? ORDER BY created_at ASC"
      : "SELECT * FROM finding_feedbacks WHERE pr_key = ? ORDER BY created_at ASC";
    const parameters = fingerprint ? [prKey, fingerprint] : [prKey];
    return this.storage.sql
      .exec<FindingFeedbackRow>(query, ...parameters)
      .toArray()
      .map(rowToFindingFeedbackRecord);
  }

  public recordReviewDecision(
    runId: RunId,
    decision: Omit<ReviewDecisionContext, "checkRunId" | "runId">,
  ): void {
    const parsedRunId = runIdSchema.parse(runId);
    const output = reviewOutputPreferencesSchema.parse(decision.output);
    const mediumThreshold = positiveIntegerSchema.parse(
      decision.verdictPolicy.mediumSeverityThreshold,
    );
    const headSha = gitShaSchema.parse(decision.headSha);
    const scopeStatus = reviewScopeStatusSchema.parse(decision.scopeStatus);
    if (
      !Number.isSafeInteger(decision.shardsAnalyzed) ||
      decision.shardsAnalyzed < 0 ||
      !Number.isSafeInteger(decision.totalShards) ||
      decision.totalShards < decision.shardsAnalyzed
    ) {
      throw new TypeError("review decision shard counts are invalid");
    }
    const cursor = this.storage.sql.exec(
      `UPDATE runs SET
         decision_head_sha = ?, decision_scope_status = ?,
         decision_shards_analyzed = ?, decision_total_shards = ?,
         decision_is_degraded = ?, decision_output_json = ?, decision_medium_threshold = ?
       WHERE id = ?`,
      headSha,
      scopeStatus,
      decision.shardsAnalyzed,
      decision.totalShards,
      decision.isDegraded ? 1 : 0,
      JSON.stringify(output),
      mediumThreshold,
      parsedRunId,
    );
    if (cursor.rowsWritten !== 1) {
      throw new Error("Review decision run was not found");
    }
  }

  public loadLatestReviewDecision(
    prKey: PrKey,
  ): ReviewDecisionContext | undefined {
    const row = this.storage.sql
      .exec<ReviewDecisionRow>(
        `SELECT id, github_check_run_id, decision_head_sha,
                decision_scope_status, decision_shards_analyzed,
                decision_total_shards, decision_is_degraded, decision_output_json, decision_medium_threshold
         FROM runs
         WHERE pr_key = ?
           AND id = (SELECT value FROM metadata WHERE key = 'latest_run_id')
         LIMIT 1`,
        prKey,
      )
      .toArray()[0];
    if (
      row === undefined ||
      row.decision_output_json === null ||
      row.decision_medium_threshold === null ||
      row.decision_head_sha === null ||
      row.decision_scope_status === null ||
      row.decision_shards_analyzed === null ||
      row.decision_total_shards === null ||
      row.decision_is_degraded === null
    ) {
      return undefined;
    }
    return {
      ...(row.github_check_run_id === null
        ? {}
        : { checkRunId: positiveIntegerSchema.parse(row.github_check_run_id) }),
      verdictPolicy: {
        mediumSeverityThreshold: positiveIntegerSchema.parse(
          row.decision_medium_threshold,
        ),
      },
      output: reviewOutputPreferencesSchema.parse(
        JSON.parse(row.decision_output_json),
      ),
      headSha: gitShaSchema.parse(row.decision_head_sha),
      isDegraded: row.decision_is_degraded === 1,
      runId: runIdSchema.parse(row.id) as RunId,
      scopeStatus: reviewScopeStatusSchema.parse(row.decision_scope_status),
      shardsAnalyzed: row.decision_shards_analyzed,
      totalShards: row.decision_total_shards,
    };
  }

  public applyFindingFeedback(
    input: ApplyFindingFeedbackInput,
  ): AppliedFindingFeedback {
    const deliveryId = validateDeliveryId(input.deliveryId);
    const targetCommentId = positiveIntegerSchema.parse(input.targetCommentId);
    const githubCommentId = positiveIntegerSchema.parse(input.githubCommentId);
    let result: AppliedFindingFeedback = {
      activeFindings: [],
      outcome: "not_found",
    };

    this.storage.transactionSync(() => {
      const duplicate = this.feedbackByDelivery(deliveryId);
      if (duplicate !== undefined) {
        result = {
          activeFindings: this.activeFindings(input.prKey),
          decision: this.loadLatestReviewDecision(input.prKey),
          feedback: rowToFindingFeedbackRecord(duplicate),
          outcome: "duplicate",
          ...(duplicate.reply_comment_id === null
            ? {}
            : { replyCommentId: duplicate.reply_comment_id }),
        };
        return;
      }

      const target = this.findFindingByCommentId(input.prKey, targetCommentId);
      if (target === undefined) return;
      const feedback = findingFeedbackRecordSchema.parse({
        authorAssociation: input.authorAssociation,
        authorLogin: input.authorLogin,
        createdAt: input.createdAt,
        fingerprint: target.fingerprint,
        githubCommentId,
        label: input.label,
        prKey: input.prKey,
        reason: input.reason,
        targetSeverity: input.targetSeverity,
      });
      this.storage.sql.exec(
        `INSERT INTO finding_feedbacks (
           pr_key, fingerprint, label, author_login, reason, target_severity,
           github_comment_id, created_at, delivery_id, author_association
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.prKey,
        feedback.fingerprint,
        feedback.label,
        feedback.authorLogin,
        feedback.reason ?? null,
        feedback.targetSeverity ?? null,
        feedback.githubCommentId ?? null,
        feedback.createdAt,
        deliveryId,
        feedback.authorAssociation ?? null,
      );
      if (input.update !== undefined) {
        const assignment =
          "status" in input.update
            ? { column: "status", value: input.update.status }
            : { column: "severity", value: input.update.severity };
        this.storage.sql.exec(
          `UPDATE pr_findings SET ${assignment.column} = ?, updated_at = ? WHERE pr_key = ? AND fingerprint = ?`,
          assignment.value,
          feedback.createdAt,
          input.prKey,
          feedback.fingerprint,
        );
      }
      result = {
        activeFindings: this.activeFindings(input.prKey),
        decision: this.loadLatestReviewDecision(input.prKey),
        feedback,
        outcome: "applied",
      };
    });
    return result;
  }

  public completeFeedbackReply(
    deliveryId: string,
    replyCommentId: number,
  ): void {
    this.storage.sql.exec(
      "UPDATE finding_feedbacks SET reply_comment_id = ? WHERE delivery_id = ?",
      positiveIntegerSchema.parse(replyCommentId),
      validateDeliveryId(deliveryId),
    );
  }

  private activeFindings(prKey: PrKey): readonly TrackedFinding[] {
    return this.storage.sql
      .exec<PrFindingRow>(
        "SELECT * FROM pr_findings WHERE pr_key = ? AND status IN ('new', 'persistent', 'reintroduced') ORDER BY file_path, line",
        prKey,
      )
      .toArray()
      .map(rowToTrackedFinding);
  }

  private feedbackByDelivery(
    deliveryId: string,
  ): FindingFeedbackRow | undefined {
    return this.storage.sql
      .exec<FindingFeedbackRow>(
        "SELECT * FROM finding_feedbacks WHERE delivery_id = ? LIMIT 1",
        deliveryId,
      )
      .toArray()[0];
  }
}
