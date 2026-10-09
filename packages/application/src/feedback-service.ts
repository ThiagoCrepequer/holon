import type { ReviewLanguage } from "@holon/contracts";
import type {
  FindingFeedbackRecord,
  FindingSeverity,
  PrKey,
  ReviewVerdict,
  TrackedFinding,
} from "@holon/domain";
import {
  determineReviewVerdict,
  reviewText,
  isAuthorizedFeedbackAuthor,
  isDismissalFeedback,
  parseFeedbackCommand,
} from "@holon/domain";

import type {
  AppliedFindingFeedback,
  ApplyFindingFeedbackInput,
  FeedbackLedger,
  ReviewPublisher,
} from "./ports.js";
import { requireConclusivePublicationLookup } from "./publication-lookup.js";

export interface ProcessFeedbackCommentInput {
  readonly authorAssociation?: string | undefined;
  readonly authorLogin: string;
  readonly body: string;
  readonly commentId: number;
  readonly createdAt?: string | undefined;
  readonly deliveryId: string;
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
  readonly authorLogin: string;
  readonly authorized: boolean;
  readonly createdAt?: string | undefined;
  readonly deliveryId: string;
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

function activeVerdictCandidates(findings: readonly TrackedFinding[]) {
  return findings.map((finding) => ({
    confidence: finding.confidence ?? 1,
    severity: finding.severity,
  }));
}

function checkRunPresentation(
  verdict: ReviewVerdict,
  language: ReviewLanguage,
) {
  return {
    conclusion:
      verdict === "APPROVE"
        ? ("success" as const)
        : verdict === "REQUEST_CHANGES"
          ? ("failure" as const)
          : ("neutral" as const),
    title:
      verdict === "APPROVE"
        ? reviewText(
            language,
            "Holon Review — Approved",
            "Holon Review — Aprovado",
            "Holon Review — Aprobado",
          )
        : verdict === "REQUEST_CHANGES"
          ? reviewText(
              language,
              "Holon Review — Changes Requested",
              "Holon Review — Alterações solicitadas",
              "Holon Review — Cambios solicitados",
            )
          : reviewText(
              language,
              "Holon Review — Informational",
              "Holon Review — Informativo",
              "Holon Review — Informativo",
            ),
  };
}

async function publishReplyOnce(
  application: AppliedFindingFeedback,
  deliveryId: string,
  targetCommentId: number,
  body: string,
  ledger: FeedbackLedger,
  publisher: ReviewPublisher,
): Promise<boolean> {
  if (application.replyCommentId !== undefined) return false;
  if (publisher.replyToComment === undefined) return false;

  const marker = `<!-- holon;feedback=${encodeURIComponent(deliveryId)} -->`;
  const existing = requireConclusivePublicationLookup(
    await publisher.findCommentByMarker(marker, "inline"),
  );
  const replyCommentId =
    existing.status === "found"
      ? existing.id
      : await publisher.replyToComment(targetCommentId, `${body}\n\n${marker}`);
  await ledger.completeFeedbackReply(deliveryId, replyCommentId);
  return existing.status === "absent";
}

async function recalculateVerdict(
  application: AppliedFindingFeedback,
  summary: string,
  publisher: ReviewPublisher,
): Promise<ReviewVerdict | undefined> {
  const decision = application.decision;
  if (decision === undefined) return undefined;

  const verdictDetails = determineReviewVerdict({
    language: decision.output.language,
    options: decision.verdictPolicy,
    findings: activeVerdictCandidates(application.activeFindings),
    isDegraded: decision.isDegraded,
    scopeStatus: decision.scopeStatus,
    shardsAnalyzed: decision.shardsAnalyzed,
    totalShards: decision.totalShards,
  });
  if (
    decision.checkRunId !== undefined &&
    publisher.updateCheckRun !== undefined
  ) {
    const presentation = checkRunPresentation(
      verdictDetails.verdict,
      decision.output.language,
    );
    await publisher.updateCheckRun({
      checkRunId: decision.checkRunId,
      conclusion: presentation.conclusion,
      output: { summary, title: presentation.title },
    });
  }
  return verdictDetails.verdict;
}

function findingUpdate(
  label: FindingFeedbackRecord["label"],
  targetSeverity?: FindingSeverity,
): ApplyFindingFeedbackInput["update"] {
  if (isDismissalFeedback(label)) return { status: "dismissed" };
  if (label === "wrong_severity" && targetSeverity !== undefined) {
    return { severity: targetSeverity };
  }
  return undefined;
}

export async function processFeedbackComment(
  input: ProcessFeedbackCommentInput,
  ledger: FeedbackLedger,
  publisher: ReviewPublisher,
): Promise<ProcessFeedbackCommentResult> {
  const command = parseFeedbackCommand(input.body);
  if (command === undefined) return { actionTaken: "ignored" };

  if (
    (isDismissalFeedback(command.label) ||
      command.label === "wrong_severity") &&
    !isAuthorizedFeedbackAuthor(input.authorAssociation)
  ) {
    return { actionTaken: "unauthorized" };
  }

  const targetCommentId = input.inReplyToCommentId ?? input.commentId;
  const application = await ledger.applyFindingFeedback({
    authorAssociation: input.authorAssociation,
    authorLogin: input.authorLogin,
    createdAt: input.createdAt ?? new Date().toISOString(),
    deliveryId: input.deliveryId,
    githubCommentId: input.commentId,
    label: command.label,
    prKey: input.prKey,
    reason: command.reason,
    targetCommentId,
    targetSeverity: command.targetSeverity,
    update: findingUpdate(command.label, command.targetSeverity),
  });
  if (application.outcome === "not_found") return { actionTaken: "ignored" };

  const language = application.decision?.output.language ?? "en";
  const changesVerdict =
    isDismissalFeedback(command.label) || command.label === "wrong_severity";
  const newVerdict = changesVerdict
    ? await recalculateVerdict(
        application,
        reviewText(
          language,
          `Verdict recalculated after finding feedback (${command.label}).`,
          `Veredito recalculado após feedback sobre o achado (${command.label}).`,
          `Veredicto recalculado tras los comentarios sobre el hallazgo (${command.label}).`,
        ),
        publisher,
      )
    : undefined;

  const reply = changesVerdict
    ? reviewText(
        language,
        `Feedback applied as ${command.label}.`,
        `Feedback aplicado como ${command.label}.`,
        `Comentarios aplicados como ${command.label}.`,
      ) +
      " " +
      (newVerdict === undefined
        ? reviewText(
            language,
            "The verdict will be recalculated on the next complete run.",
            "O veredito será recalculado na próxima execução completa.",
            "El veredicto se recalculará en la próxima ejecución completa.",
          )
        : reviewText(
            language,
            `PR verdict recalculated to **${newVerdict}**.`,
            `Veredito do PR recalculado para **${newVerdict}**.`,
            `Veredicto del PR recalculado a **${newVerdict}**.`,
          ))
    : reviewText(
        language,
        "Thank you for the feedback. Recorded for model calibration.",
        "Obrigado pelo feedback! Registrado para calibração do modelo.",
        "Gracias por los comentarios. Registrados para la calibración del modelo.",
      );
  const replyPosted = await publishReplyOnce(
    application,
    input.deliveryId,
    input.commentId,
    reply,
    ledger,
    publisher,
  );

  return {
    actionTaken: isDismissalFeedback(command.label) ? "dismissed" : "recorded",
    feedback: application.feedback,
    ...(newVerdict === undefined ? {} : { newVerdict }),
    replyPosted,
    ...(changesVerdict
      ? { verdictRecalculated: newVerdict !== undefined }
      : {}),
  };
}

export async function processThreadResolved(
  input: ProcessThreadResolvedInput,
  ledger: FeedbackLedger,
  publisher: ReviewPublisher,
): Promise<ProcessThreadResolvedResult> {
  if (!input.authorized) return { actionTaken: "ignored" };

  const application = await ledger.applyFindingFeedback({
    authorLogin: input.authorLogin,
    createdAt: input.createdAt ?? new Date().toISOString(),
    deliveryId: input.deliveryId,
    githubCommentId: input.rootCommentId,
    label: "thread_resolved",
    prKey: input.prKey,
    targetCommentId: input.rootCommentId,
    update: { status: "dismissed" },
  });
  if (application.outcome === "not_found") return { actionTaken: "ignored" };

  const newVerdict = await recalculateVerdict(
    application,
    reviewText(
      application.decision?.output.language ?? "en",
      "Verdict recalculated after thread resolution.",
      "Veredito recalculado após a resolução da discussão.",
      "Veredicto recalculado tras resolver la conversación.",
    ),
    publisher,
  );
  return {
    actionTaken: "dismissed",
    feedback: application.feedback,
    ...(newVerdict === undefined ? {} : { newVerdict }),
    verdictRecalculated: newVerdict !== undefined,
  };
}
