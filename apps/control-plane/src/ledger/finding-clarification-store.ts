import {
  renderClarificationReply,
  unavailableClarification,
  verifyClarificationAnswer,
} from "@holon/application";
import {
  clarificationAdmissionSchema,
  clarificationHistorySchema,
  clarificationRecordSchema,
  clarificationReadSchema,
  clarificationLimits,
  modelGenerationReservationSchema,
  positiveIntegerSchema,
  type ClarificationAdmission,
  type ClarificationRecord,
  type ClarificationRead,
  type ModelGenerationReservation,
  type ModelGenerationAdmission,
} from "@holon/contracts";
import {
  createPrKey,
  determineReviewVerdict,
  redactSecrets,
  reviewText,
} from "@holon/domain";

import { CheckRunReconciliationStore } from "./check-run-reconciliation.js";
import { FindingLedgerStore } from "./finding-ledger-store.js";

/** PR-local identity, admission, budgets and corrections share the review authority transaction. */
export class FindingClarificationStore {
  constructor(private readonly storage: DurableObjectStorage) {}
  load(id: number): ClarificationRecord | undefined {
    const row = this.storage.sql
      .exec<{ payload: string }>(
        "SELECT payload FROM finding_clarifications WHERE id=?",
        positiveIntegerSchema.parse(id),
      )
      .toArray()[0];
    return row
      ? clarificationRecordSchema.parse(JSON.parse(row.payload))
      : undefined;
  }
  private save(record: ClarificationRecord): void {
    const parsed = clarificationRecordSchema.parse(record);
    this.storage.sql.exec(
      "UPDATE finding_clarifications SET payload=? WHERE id=?",
      JSON.stringify(parsed),
      parsed.id,
    );
  }
  history(id: number) {
    const record = this.load(id);
    if (!record) return [];
    return clarificationHistorySchema.parse(
      this.storage.sql
        .exec<{ payload: string }>(
          "SELECT payload FROM finding_clarifications WHERE run_id=? AND id<? AND json_extract(payload,'$.finding.fingerprint')=? AND json_extract(payload,'$.state')='published' ORDER BY id DESC LIMIT 2",
          record.runId,
          record.id,
          record.finding.fingerprint,
        )
        .toArray()
        .toReversed()
        .map((row) => {
          const previous = clarificationRecordSchema.parse(
            JSON.parse(row.payload),
          );
          const answer = previous.answer!;
          return {
            question: previous.question,
            outcome: answer.outcome,
            explanation: answer.explanation,
            scenario: answer.scenario,
          };
        }),
    );
  }
  private current(record: ClarificationRecord): boolean {
    const latest = this.storage.sql
      .exec<{ value: string }>(
        "SELECT value FROM metadata WHERE key='latest_run_id'",
      )
      .toArray()[0]?.value;
    const finding = new FindingLedgerStore(this.storage).findFindingByCommentId(
      record.finding.prKey,
      record.finding.githubCommentId!,
    );
    return (
      latest === record.runId &&
      finding?.lastSeenRunId === record.runId &&
      finding.evidenceFingerprint === record.finding.evidenceFingerprint &&
      finding.diagnostic === record.finding.diagnostic &&
      (record.correctionApplied ||
        ["new", "persistent", "reintroduced"].includes(finding.status))
    );
  }
  authorized(id: number): boolean {
    const record = this.load(id);
    return (
      !!record &&
      record.state === "pending" &&
      Date.now() < record.deadlineAt &&
      this.current(record)
    );
  }
  admit(raw: ClarificationAdmission): ClarificationRecord | undefined {
    const input = clarificationAdmissionSchema.parse(raw);
    return this.storage.transactionSync(() => {
      const existing = this.load(input.event.commentId);
      if (existing) return existing;
      const prKey = createPrKey({
        provider: "github",
        repositoryId: input.event.repository.id,
        pullRequestNumber: input.event.pullRequestNumber,
      });
      const store = new FindingLedgerStore(this.storage);
      const decision = store.loadLatestReviewDecision(prKey);
      const finding = input.event.inReplyToId
        ? store.findFindingByCommentId(prKey, input.event.inReplyToId)
        : undefined;
      if (
        !decision ||
        !finding ||
        finding.identityAmbiguous ||
        decision.headSha !== input.headSha ||
        decision.runId !==
          `${prKey}:head:${input.headSha}:base:${input.baseSha}` ||
        finding.lastSeenRunId !== decision.runId ||
        finding.lastSeenHeadSha !== input.headSha ||
        !["new", "persistent", "reintroduced"].includes(finding.status)
      )
        return undefined;
      const state = this.storage.sql
        .exec<{ state: string }>(
          "SELECT state FROM runs WHERE id=?",
          decision.runId,
        )
        .toArray()[0]?.state;
      if (state !== "completed") return undefined;
      const records = this.storage.sql
        .exec<{ payload: string }>(
          "SELECT payload FROM finding_clarifications WHERE run_id=?",
          decision.runId,
        )
        .toArray()
        .map((row) => clarificationRecordSchema.parse(JSON.parse(row.payload)));
      if (
        records.length >= clarificationLimits.questionsPerHead ||
        records.filter(
          (record) => record.finding.fingerprint === finding.fingerprint,
        ).length >= clarificationLimits.questionsPerFinding
      )
        return undefined;
      const busy = records.some(
        (record) =>
          record.state === "pending" && record.deadlineAt > Date.now(),
      );
      const busyAnswer = busy
        ? {
            ...unavailableClarification(decision.output.language),
            explanation: reviewText(
              decision.output.language,
              "Another finding investigation is in progress. Wait for its answer before posting a new question.",
              "Outra investigação de finding está em andamento. Aguarde a resposta antes de enviar uma nova pergunta.",
              "Otra investigación está en curso. Espera su respuesta antes de enviar otra pregunta.",
            ),
          }
        : undefined;
      const record = clarificationRecordSchema.parse({
        ...input,
        id: input.event.commentId,
        prKey,
        runId: decision.runId,
        finding,
        language: decision.output.language,
        state: busy ? "answered" : "pending",
        ...(busyAnswer ? { answer: busyAnswer } : {}),
        deadlineAt: Date.now() + clarificationLimits.deadlineMs,
        correctionApplied: false,
        question: redactSecrets(input.question),
        event: { ...input.event, body: redactSecrets(input.event.body) },
      });
      this.storage.sql.exec(
        "INSERT INTO finding_clarifications(id,run_id,payload,tool_calls,read_bytes) VALUES (?,?,?,0,0)",
        record.id,
        record.runId,
        JSON.stringify(record),
      );
      return record;
    });
  }
  reserveRead(id: number): boolean {
    return this.storage.transactionSync(() => {
      if (!this.authorized(id)) return false;
      return (
        this.storage.sql.exec(
          "UPDATE finding_clarifications SET tool_calls=tool_calls+1 WHERE id=? AND tool_calls<?",
          id,
          clarificationLimits.toolCalls,
        ).rowsWritten === 1
      );
    });
  }
  recordRead(id: number, raw: ClarificationRead): boolean {
    const read = clarificationReadSchema.parse(raw);
    const bytes = new TextEncoder().encode(read.content).byteLength;
    return this.storage.transactionSync(() => {
      if (!this.authorized(id)) return false;
      const updated = this.storage.sql.exec(
        "UPDATE finding_clarifications SET read_bytes=read_bytes+? WHERE id=? AND read_bytes+?<=?",
        bytes,
        id,
        bytes,
        clarificationLimits.readBytes,
      );
      if (!updated.rowsWritten) return false;
      this.storage.sql.exec(
        "INSERT INTO clarification_reads(question_id,payload) VALUES (?,?)",
        id,
        JSON.stringify(read),
      );
      return true;
    });
  }
  reserveGeneration(
    id: number,
    raw: Omit<ModelGenerationReservation, "shardIndex" | "shardCount">,
  ): ModelGenerationAdmission | undefined {
    const request = modelGenerationReservationSchema.parse({
      ...raw,
      shardIndex: 0,
      shardCount: 1,
    });
    if (request.phase !== "finding_clarification")
      throw new TypeError("Invalid clarification phase");
    return this.storage.transactionSync(() => {
      if (!this.authorized(id)) return undefined;
      const totals = this.storage.sql
        .exec<{ calls: number; input: number; output: number }>(
          "SELECT COUNT(*) AS calls,COALESCE(SUM(input_bytes),0) AS input,COALESCE(SUM(output_tokens),0) AS output FROM clarification_generations WHERE question_id=?",
          id,
        )
        .one();
      const checks = [
        ["calls", totals.calls, 1, clarificationLimits.generationCalls],
        [
          "input_bytes",
          totals.input,
          request.inputBytes,
          clarificationLimits.inputBytes,
        ],
        [
          "output_tokens",
          totals.output,
          request.outputTokens,
          clarificationLimits.outputTokens,
        ],
      ] as const;
      for (const [reason, consumed, requested, limit] of checks)
        if (consumed + requested > limit)
          return { accepted: false, reason, consumed, requested, limit };
      const reservation = this.storage.sql
        .exec<{ id: number }>(
          "INSERT INTO clarification_generations(question_id,input_bytes,output_tokens,settled) VALUES (?,?,?,0) RETURNING id",
          id,
          request.inputBytes,
          request.outputTokens,
        )
        .one().id;
      return {
        accepted: true,
        id: reservation,
        outputTokens: request.outputTokens,
      };
    });
  }
  settleGeneration(
    id: number,
    reservationId: number,
    outputTokens: number,
  ): void {
    positiveIntegerSchema.parse(id);
    positiveIntegerSchema.parse(reservationId);
    if (!Number.isSafeInteger(outputTokens) || outputTokens < 0)
      throw new TypeError("Invalid token settlement");
    this.storage.sql.exec(
      "UPDATE clarification_generations SET output_tokens=?,settled=1 WHERE id=? AND question_id=? AND settled=0",
      outputTokens,
      reservationId,
      id,
    );
  }
  answer(id: number, raw: unknown): ClarificationRecord {
    return this.storage.transactionSync(() => {
      const record = this.load(id);
      if (!record) throw new Error("Question unavailable");
      if (record.state !== "pending") return record;
      const reads = this.storage.sql
        .exec<{ payload: string }>(
          "SELECT payload FROM clarification_reads WHERE question_id=?",
          id,
        )
        .toArray()
        .map((row) => clarificationReadSchema.parse(JSON.parse(row.payload)));
      const current = this.current(record);
      const answer =
        Date.now() <= record.deadlineAt
          ? verifyClarificationAnswer(raw, reads, record.language)
          : unavailableClarification(record.language);
      const correctionApplied =
        current && answer.outcome === "refuted" && answer.confidence >= 0.9;
      if (correctionApplied)
        this.storage.sql.exec(
          "UPDATE pr_findings SET status='dismissed',updated_at=? WHERE pr_key=? AND fingerprint=? AND last_seen_run_id=?",
          new Date().toISOString(),
          record.prKey,
          record.finding.fingerprint,
          record.runId,
        );
      const result: ClarificationRecord = {
        ...record,
        answer,
        state: current ? "answered" : "obsolete",
        correctionApplied,
      };
      this.save(result);
      if (correctionApplied) {
        const store = new FindingLedgerStore(this.storage);
        const decision = store.loadLatestReviewDecision(record.finding.prKey)!;
        if (decision.checkRunId !== undefined) {
          const verdict = determineReviewVerdict({
            language: decision.output.language,
            options: decision.verdictPolicy,
            findings: store
              .loadPrFindings(record.finding.prKey)
              .filter((finding) =>
                ["new", "persistent", "reintroduced"].includes(finding.status),
              )
              .map((finding) => ({
                confidence: finding.confidence,
                severity: finding.severity,
              })),
            isDegraded: decision.isDegraded,
            scopeStatus: decision.scopeStatus,
            shardsAnalyzed: decision.shardsAnalyzed,
            totalShards: decision.totalShards,
          });
          new CheckRunReconciliationStore(this.storage).schedule(record.runId, {
            language: record.language,
            baseSha: record.baseSha,
            installationId: record.event.installationId,
            repositoryId: record.event.repository.id,
            owner: record.event.repository.owner,
            repo: record.event.repository.name,
            pullNumber: record.event.pullRequestNumber,
            input: {
              externalId: record.runId,
              headSha: record.headSha,
              status: "completed",
              completedAt: new Date().toISOString(),
              conclusion:
                verdict.verdict === "APPROVE"
                  ? "success"
                  : verdict.verdict === "REQUEST_CHANGES"
                    ? "failure"
                    : "neutral",
              output: {
                title: `Holon Review — ${verdict.verdict}`,
                summary: renderClarificationReply(result),
              },
            },
          });
        }
      }
      this.storage.sql.exec(
        "DELETE FROM clarification_reads WHERE question_id=?",
        id,
      );
      return result;
    });
  }
  canPublish(id: number): boolean {
    const record = this.load(id);
    return !!record && record.state === "answered" && this.current(record);
  }
  complete(id: number, commentId?: number): void {
    const record = this.load(id);
    if (!record || record.state === "published") return;
    this.save({
      ...record,
      state: commentId ? "published" : "obsolete",
      ...(commentId
        ? { replyCommentId: positiveIntegerSchema.parse(commentId) }
        : {}),
    });
    this.storage.sql.exec(
      "DELETE FROM clarification_reads WHERE question_id=?",
      id,
    );
  }
  nextExpiration(): number | undefined {
    const row = this.storage.sql
      .exec<{ deadline: number | null }>(
        "SELECT MIN(json_extract(payload,'$.deadlineAt')) AS deadline FROM finding_clarifications WHERE json_extract(payload,'$.state')='pending'",
      )
      .one();
    return row.deadline ?? undefined;
  }
  expire(): void {
    for (const row of this.storage.sql
      .exec<{ id: number }>(
        "SELECT id FROM finding_clarifications WHERE json_extract(payload,'$.state')='pending' AND json_extract(payload,'$.deadlineAt')<=?",
        Date.now(),
      )
      .toArray()) {
      const record = this.load(row.id)!;
      this.answer(record.id, unavailableClarification(record.language));
    }
  }
}
