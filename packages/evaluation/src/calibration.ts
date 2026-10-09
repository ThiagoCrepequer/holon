import {
  calibrationMetricsSchema,
  type CalibrationMetrics,
  type FindingFeedbackRecord,
  type TrackedFinding,
} from "@holon/contracts";

export function computeCalibrationMetrics(
  feedbacks: readonly FindingFeedbackRecord[],
  totalReviewedFindings: number,
): CalibrationMetrics {
  const groups = new Map<string, Set<FindingFeedbackRecord["label"]>>();
  for (const feedback of feedbacks) {
    const key = `${feedback.prKey}:${feedback.fingerprint}`;
    const labels = groups.get(key) ?? new Set();
    labels.add(feedback.label);
    groups.set(key, labels);
  }
  if (
    !Number.isSafeInteger(totalReviewedFindings) ||
    totalReviewedFindings < groups.size
  ) {
    throw new TypeError(
      "reviewed finding count must cover unique feedback findings",
    );
  }
  let falsePositiveCount = 0;
  let helpfulCount = 0;
  let wrongSeverityCount = 0;
  let conflictedFindings = 0;
  let resolvedFindings = 0;
  let adjudicatedFindings = 0;
  for (const labels of groups.values()) {
    const rejected = ["false_positive", "not_actionable", "duplicate"].some(
      (label) => labels.has(label as FindingFeedbackRecord["label"]),
    );
    const accepted = labels.has("helpful") || labels.has("wrong_severity");
    if (labels.has("thread_resolved")) resolvedFindings++;
    if (accepted && rejected) {
      conflictedFindings++;
      continue;
    }
    if (accepted || rejected) adjudicatedFindings++;
    if (rejected) falsePositiveCount++;
    if (labels.has("helpful")) helpfulCount++;
    if (labels.has("wrong_severity")) wrongSeverityCount++;
  }
  return calibrationMetricsSchema.parse({
    falsePositiveCount,
    falsePositiveRate:
      adjudicatedFindings === 0
        ? null
        : falsePositiveCount / adjudicatedFindings,
    helpfulCount,
    totalFeedbacks: feedbacks.length,
    totalReviewedFindings,
    utilityRate:
      adjudicatedFindings === 0 ? null : helpfulCount / adjudicatedFindings,
    wrongSeverityCount,
    adjudicatedFindings,
    conflictedFindings,
    resolvedFindings,
  });
}

export interface CalibrationCandidateCase {
  readonly description: string;
  readonly requiresAdjudication: true;
  readonly feedbackLabel: string;
  readonly filePath: string;
  readonly fingerprint: string;
  readonly reason?: string | undefined;
  readonly severity?: string | undefined;
}

export function promoteFeedbackToCalibrationCase(
  feedback: FindingFeedbackRecord,
  finding?: TrackedFinding,
): CalibrationCandidateCase {
  return {
    description: `Calibration case from feedback ${feedback.label}: ${feedback.reason ?? finding?.diagnostic ?? "No description"}`,
    requiresAdjudication: true,
    feedbackLabel: feedback.label,
    filePath: finding?.filePath ?? "unknown",
    fingerprint: feedback.fingerprint,
    reason: feedback.reason,
    severity: feedback.targetSeverity ?? finding?.severity,
  };
}
