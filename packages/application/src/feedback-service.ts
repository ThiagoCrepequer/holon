import type {
  FindingFeedbackRecord,
  PrKey,
  ReviewVerdict,
} from "@holon/domain";
import {
  applyFeedbackToFindings,
  determineReviewVerdict,
  isAuthorizedFeedbackAuthor,
  isDismissalFeedback,
  parseFeedbackCommand,
} from "@holon/domain";

import type { ReviewLedger, ReviewPublisher } from "./ports.js";

export interface ProcessFeedbackCommentInput {
  readonly authorAssociation?: string | undefined;
  readonly authorLogin: string;
  readonly body: string;
  readonly commentId: number;
  readonly createdAt?: string | undefined;
  readonly inReplyToCommentId?: number | undefined;
  readonly prKey: PrKey;
  readonly pullRequestNumber: number;
}

export interface ProcessFeedbackCommentResult {
  readonly actionTaken: "dismissed" | "recorded" | "ignored" | "unauthorized";
  readonly feedback?: FindingFeedbackRecord | undefined;
  readonly newVerdict?: ReviewVerdict | undefined;
  readonly replyPosted?: boolean | undefined;
  readonly verdictRecalculated?: boolean | undefined;
}

export interface ProcessThreadResolvedInput {
  readonly authorAssociation?: string | undefined;
  readonly authorLogin: string;
  readonly createdAt?: string | undefined;
  readonly prKey: PrKey;
  readonly pullRequestNumber: number;
  readonly rootCommentId: number;
}

export interface ProcessThreadResolvedResult {
  readonly actionTaken: "dismissed" | "ignored";
  readonly feedback?: FindingFeedbackRecord | undefined;
  readonly newVerdict?: ReviewVerdict | undefined;
  readonly verdictRecalculated?: boolean | undefined;
}

export async function processFeedbackComment(
  input: ProcessFeedbackCommentInput,
  ledger: ReviewLedger,
  publisher: ReviewPublisher,
): Promise<ProcessFeedbackCommentResult> {
  const command = parseFeedbackCommand(input.body);
  if (!command) {
    return { actionTaken: "ignored" };
  }

  const targetCommentId = input.inReplyToCommentId ?? input.commentId;
  const finding = await ledger.findFindingByCommentId?.(
    input.prKey,
    targetCommentId,
  );
  if (!finding) {
    return { actionTaken: "ignored" };
  }

  const createdAt = input.createdAt ?? new Date().toISOString();
  const feedbackRecord: FindingFeedbackRecord = {
    authorAssociation: input.authorAssociation,
    authorLogin: input.authorLogin,
    createdAt,
    fingerprint: finding.fingerprint,
    githubCommentId: input.commentId,
    label: command.label,
    prKey: input.prKey,
    reason: command.reason,
    targetSeverity: command.targetSeverity,
  };

  await ledger.recordFindingFeedback?.(input.prKey, feedbackRecord);

  if (isDismissalFeedback(command.label)) {
    if (!isAuthorizedFeedbackAuthor(input.authorAssociation)) {
      let replyPosted = false;
      if (publisher.replyToComment) {
        await publisher.replyToComment(
          input.commentId,
          "⚠️ Apenas mantenedores do repositório (com permissão de OWNER, MEMBER ou COLLABORATOR) podem dispensar apontamentos ou alterar o veredito do PR.",
        );
        replyPosted = true;
      }
      return {
        actionTaken: "unauthorized",
        feedback: feedbackRecord,
        replyPosted,
      };
    }

    const allFindings = (await ledger.loadPrFindings?.(input.prKey)) ?? [];
    const updatedFindings = applyFeedbackToFindings(allFindings, [
      feedbackRecord,
    ]);
    await ledger.savePrFindings?.(input.prKey, updatedFindings);

    const activeCandidates = updatedFindings
      .filter(
        (f) =>
          f.status === "new" ||
          f.status === "persistent" ||
          f.status === "reintroduced",
      )
      .map((f) => ({
        confidence: 0.9,
        diagnostic: f.diagnostic,
        evidence: [
          {
            excerpt: f.diagnostic,
            path: f.filePath,
            reason: f.diagnostic,
            startLine: f.line,
          },
        ],
        location: {
          line: f.line,
          path: f.filePath,
          side: "RIGHT" as const,
        },
        severity: f.severity,
      }));

    const verdictDetails = determineReviewVerdict({
      findings: activeCandidates,
      scopeStatus: "complete",
    });

    const externalId = `check-run:${input.prKey}`;
    const checkRunId = await publisher.findCheckRunByExternalId?.(externalId);
    if (checkRunId && publisher.updateCheckRun) {
      const conclusion =
        verdictDetails.verdict === "APPROVE"
          ? "success"
          : verdictDetails.verdict === "REQUEST_CHANGES"
            ? "failure"
            : "neutral";
      const title =
        verdictDetails.verdict === "APPROVE"
          ? "Holon Review — Approved"
          : "Holon Review — Changes Requested";
      await publisher.updateCheckRun({
        checkRunId,
        conclusion,
        output: {
          summary: `Verdict recalculated after finding dismissal (${command.label}).`,
          title,
        },
      });
    }

    let replyPosted = false;
    if (publisher.replyToComment) {
      const labelText = command.label.replaceAll("_", " ");
      const reasonText = command.reason ? `: "${command.reason}"` : "";
      const verdictText = ` Veredito do PR recalculado para **${verdictDetails.verdict}**.`;
      await publisher.replyToComment(
        input.commentId,
        `👀 Defeito dispensado como ${labelText}${reasonText}.${verdictText}`,
      );
      replyPosted = true;
    }

    return {
      actionTaken: "dismissed",
      feedback: feedbackRecord,
      newVerdict: verdictDetails.verdict,
      replyPosted,
      verdictRecalculated: true,
    };
  }

  if (command.label === "helpful" && publisher.replyToComment) {
    await publisher.replyToComment(
      input.commentId,
      "🙏 Obrigado pelo feedback! Registrado para calibração do modelo.",
    );
    return {
      actionTaken: "recorded",
      feedback: feedbackRecord,
      replyPosted: true,
    };
  }

  return {
    actionTaken: "recorded",
    feedback: feedbackRecord,
  };
}

export async function processThreadResolved(
  input: ProcessThreadResolvedInput,
  ledger: ReviewLedger,
  publisher: ReviewPublisher,
): Promise<ProcessThreadResolvedResult> {
  const finding = await ledger.findFindingByCommentId?.(
    input.prKey,
    input.rootCommentId,
  );
  if (
    !finding ||
    finding.status === "dismissed" ||
    finding.status === "resolved" ||
    !isAuthorizedFeedbackAuthor(input.authorAssociation)
  ) {
    return { actionTaken: "ignored" };
  }

  const createdAt = input.createdAt ?? new Date().toISOString();
  const feedbackRecord: FindingFeedbackRecord = {
    authorAssociation: input.authorAssociation,
    authorLogin: input.authorLogin,
    createdAt,
    fingerprint: finding.fingerprint,
    githubCommentId: input.rootCommentId,
    label: "thread_resolved",
    prKey: input.prKey,
  };

  await ledger.recordFindingFeedback?.(input.prKey, feedbackRecord);

  const allFindings = (await ledger.loadPrFindings?.(input.prKey)) ?? [];
  const updatedFindings = applyFeedbackToFindings(allFindings, [
    feedbackRecord,
  ]);
  await ledger.savePrFindings?.(input.prKey, updatedFindings);

  const activeCandidates = updatedFindings
    .filter(
      (f) =>
        f.status === "new" ||
        f.status === "persistent" ||
        f.status === "reintroduced",
    )
    .map((f) => ({
      confidence: 0.9,
      diagnostic: f.diagnostic,
      evidence: [
        {
          excerpt: f.diagnostic,
          path: f.filePath,
          reason: f.diagnostic,
          startLine: f.line,
        },
      ],
      location: {
        line: f.line,
        path: f.filePath,
        side: "RIGHT" as const,
      },
      severity: f.severity,
    }));

  const verdictDetails = determineReviewVerdict({
    findings: activeCandidates,
    scopeStatus: "complete",
  });

  const externalId = `check-run:${input.prKey}`;
  const checkRunId = await publisher.findCheckRunByExternalId?.(externalId);
  if (checkRunId && publisher.updateCheckRun) {
    const conclusion =
      verdictDetails.verdict === "APPROVE"
        ? "success"
        : verdictDetails.verdict === "REQUEST_CHANGES"
          ? "failure"
          : "neutral";
    const title =
      verdictDetails.verdict === "APPROVE"
        ? "Holon Review — Approved"
        : "Holon Review — Changes Requested";
    await publisher.updateCheckRun({
      checkRunId,
      conclusion,
      output: {
        summary: "Verdict recalculated after thread resolution.",
        title,
      },
    });
  }

  return {
    actionTaken: "dismissed",
    feedback: feedbackRecord,
    newVerdict: verdictDetails.verdict,
    verdictRecalculated: true,
  };
}
