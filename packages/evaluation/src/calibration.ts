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
  let falsePositiveCount = 0;
  let helpfulCount = 0;
  let wrongSeverityCount = 0;

  for (const fb of feedbacks) {
    if (
      fb.label === "false_positive" ||
      fb.label === "not_actionable" ||
      fb.label === "duplicate" ||
      fb.label === "thread_resolved"
    ) {
      falsePositiveCount += 1;
    } else if (fb.label === "helpful") {
      helpfulCount += 1;
    } else if (fb.label === "wrong_severity") {
      wrongSeverityCount += 1;
    }
  }

  const totalFeedbacks = feedbacks.length;
  const safeTotalFindings = Math.max(totalReviewedFindings, totalFeedbacks);
  const falsePositiveRate =
    safeTotalFindings > 0
      ? Number((falsePositiveCount / safeTotalFindings).toFixed(4))
      : 0;
  const utilityRate =
    totalFeedbacks > 0 ? Number((helpfulCount / totalFeedbacks).toFixed(4)) : 0;

  return calibrationMetricsSchema.parse({
    falsePositiveCount,
    falsePositiveRate: Math.min(Math.max(falsePositiveRate, 0), 1),
    helpfulCount,
    totalFeedbacks,
    totalReviewedFindings: safeTotalFindings,
    utilityRate: Math.min(Math.max(utilityRate, 0), 1),
    wrongSeverityCount,
  });
}

export interface CalibrationCandidateCase {
  readonly description: string;
  readonly expectedVerdict: "APPROVE" | "REQUEST_CHANGES";
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
  const isFP =
    feedback.label === "false_positive" ||
    feedback.label === "not_actionable" ||
    feedback.label === "duplicate";

  return {
    description: `Calibration case from feedback ${feedback.label}: ${feedback.reason ?? finding?.diagnostic ?? "No description"}`,
    expectedVerdict: isFP ? "APPROVE" : "REQUEST_CHANGES",
    feedbackLabel: feedback.label,
    filePath: finding?.filePath ?? "unknown",
    fingerprint: feedback.fingerprint,
    reason: feedback.reason,
    severity: feedback.targetSeverity ?? finding?.severity,
  };
}
