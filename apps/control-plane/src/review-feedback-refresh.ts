import { formatConfiguredFindings } from "@holon/application";
import {
  formatReconciliationSection,
  fitPublicationSummary,
} from "@holon/application";
import {
  reconciledReviewOutputSchema,
  type ReconciledReviewOutput,
} from "@holon/contracts";
import { reviewMessage } from "@holon/domain";
import {
  applyFeedbackToFindings,
  determineReviewVerdict,
  formatVerdictBadge,
  type FindingFeedbackRecord,
} from "@holon/domain";

import type { WorkflowLedger } from "./review-services.js";

export function refreshReviewFeedback(
  output: ReconciledReviewOutput,
  feedback: readonly FindingFeedbackRecord[],
): ReconciledReviewOutput {
  const tracked = applyFeedbackToFindings(
    output.updatedTrackedFindings,
    feedback,
  );
  const byId = new Map(
    tracked.map((finding) => [finding.fingerprint, finding]),
  );
  const activeFindings = output.activeFindings.flatMap((finding) => {
    const current = byId.get(finding.fingerprint);
    if (current?.status === "dismissed") return [];
    return [{ ...finding, severity: current?.severity ?? finding.severity }];
  });
  const resolvedFindings = output.resolvedFindings.filter(
    (finding) => byId.get(finding.fingerprint)?.status !== "dismissed",
  );
  if (
    tracked.every(
      (finding, index) =>
        finding.status === output.updatedTrackedFindings[index]?.status &&
        finding.severity === output.updatedTrackedFindings[index]?.severity,
    ) &&
    activeFindings.length === output.activeFindings.length &&
    resolvedFindings.length === output.resolvedFindings.length &&
    activeFindings.every(
      (finding, index) =>
        finding.severity === output.activeFindings[index]?.severity,
    )
  )
    return output;
  const activeIds = new Set(
    activeFindings.map((finding) => finding.fingerprint),
  );
  const unverifiedCount = tracked.filter(
    (finding) =>
      ["new", "persistent", "reintroduced"].includes(finding.status) &&
      !activeIds.has(finding.fingerprint),
  ).length;
  const reconciliation = {
    dismissedCount:
      (output.reconciliation?.dismissedCount ?? 0) +
      output.activeFindings.length -
      activeFindings.length,
    newCount: activeFindings.filter((finding) => finding.status === "new")
      .length,
    persistentCount: activeFindings.filter(
      (finding) => finding.status === "persistent",
    ).length,
    reintroducedCount: activeFindings.filter(
      (finding) => finding.status === "reintroduced",
    ).length,
    resolvedCount: resolvedFindings.length,
    obsoleteCount: output.reconciliation?.obsoleteCount ?? 0,
    totalActiveCount: activeFindings.length,
    ...(unverifiedCount ? { unverifiedCount } : {}),
  };
  const isDegraded =
    (output.analysisIsDegraded ?? output.isDegraded) === true ||
    unverifiedCount > 0;
  const verdictDetails = determineReviewVerdict({
    language: output.output.language,
    findings: activeFindings,
    isDegraded,
    options: output.verdictPolicy,
    scopeStatus: output.scopeStatus,
    shardsAnalyzed: output.shardsAnalyzed,
    totalShards: output.totalShards,
  });
  const summary = fitPublicationSummary(
    [
      formatVerdictBadge(verdictDetails.verdict, output.output.language),
      verdictDetails.reasons.join(" "),
    ].join("\n\n"),
    reviewMessage(output.output.language, "feedbackUpdated"),
    [
      formatReconciliationSection(reconciliation, output.output.language),
      ...output.omissionReasons,
      formatConfiguredFindings(activeFindings, output.output),
    ]
      .filter(Boolean)
      .join("\n\n"),
    output.output.language,
  );
  return reconciledReviewOutputSchema.parse({
    ...output,
    activeFindings,
    resolvedFindings,
    updatedTrackedFindings: tracked,
    reconciliation,
    isDegraded,
    verdict: verdictDetails.verdict,
    verdictDetails,
    summary,
    findings: activeFindings.map(
      ({
        identityAmbiguous: _identityAmbiguous,
        fingerprint: _fp,
        evidenceFingerprint: _ef,
        status: _status,
        firstSeenHeadSha: _sha,
        previousCommentId: _comment,
        ...finding
      }) => finding,
    ),
  });
}

export async function loadReviewWithCurrentFeedback(
  ledger: WorkflowLedger,
  runId: string,
  prKey: Parameters<WorkflowLedger["loadPrFindings"]>[0],
): Promise<ReconciledReviewOutput> {
  const [output, feedback] = await Promise.all([
    ledger.loadReviewAnalysis(runId),
    ledger.loadFindingFeedbacks(prKey),
  ]);
  return refreshReviewFeedback(output, feedback);
}
