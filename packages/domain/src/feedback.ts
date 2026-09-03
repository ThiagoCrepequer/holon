import type { FindingSeverity } from "./finding.js";
import type {
  FeedbackLabel,
  FindingFingerprint,
  FindingStatus,
  PrKey,
} from "./identity.js";
import type { TrackedFinding } from "./lifecycle.js";

export interface FindingFeedbackRecord {
  readonly authorLogin: string;
  readonly createdAt: string;
  readonly fingerprint: FindingFingerprint;
  readonly githubCommentId?: number | undefined;
  readonly id?: number | undefined;
  readonly label: FeedbackLabel;
  readonly prKey: PrKey;
  readonly reason?: string | undefined;
  readonly targetSeverity?: FindingSeverity | undefined;
}

export interface ParsedFeedbackCommand {
  readonly label: FeedbackLabel;
  readonly line?: number | undefined;
  readonly path?: string | undefined;
  readonly reason?: string | undefined;
  readonly targetSeverity?: FindingSeverity | undefined;
}

const DISMISS_COMMAND_PATTERN =
  /^\s*\/holon\s+dismiss\s+(false[-_]positive|not[-_]actionable|duplicate|wrong[-_]severity(?::(critical|high|medium|low))?)(?:\s*[:-]\s*|\s+)?(.*)$/isu;

const HELPFUL_COMMAND_PATTERN =
  /^\s*(?:\/holon\s+(?:helpful|accept)|\+1|👍)(?:\s*[:-]\s*|\s+)?(.*)$/isu;

const MISSED_DEFECT_PATTERN =
  /^\s*\/holon\s+missed[-_]defect\s+([A-Za-z0-9._/-]+):(\d+)(?:\s*[:-]\s*|\s+)?(.*)$/isu;

export function parseFeedbackCommand(
  rawBody: string,
): ParsedFeedbackCommand | undefined {
  const trimmed = rawBody.trim();
  if (trimmed.length === 0) return undefined;

  // 1. Check dismiss commands
  const dismissMatch = DISMISS_COMMAND_PATTERN.exec(trimmed);
  if (dismissMatch) {
    const rawCategory = dismissMatch[1]!.toLowerCase();
    const reasonText = dismissMatch[3]?.trim();
    const reason = reasonText && reasonText.length > 0 ? reasonText : undefined;

    if (rawCategory.startsWith("wrong")) {
      const explicitSeverity = dismissMatch[2]?.toLowerCase() as
        | FindingSeverity
        | undefined;
      return {
        label: "wrong_severity",
        reason,
        targetSeverity: explicitSeverity ?? "low",
      };
    }

    if (rawCategory.includes("false")) {
      return { label: "false_positive", reason };
    }
    if (rawCategory.includes("not")) {
      return { label: "not_actionable", reason };
    }
    if (rawCategory.includes("duplicate")) {
      return { label: "duplicate", reason };
    }
  }

  // 2. Check helpful / accept / thumbs-up commands
  const helpfulMatch = HELPFUL_COMMAND_PATTERN.exec(trimmed);
  if (helpfulMatch) {
    const reasonText = helpfulMatch[1]?.trim();
    return {
      label: "helpful",
      reason: reasonText && reasonText.length > 0 ? reasonText : undefined,
    };
  }

  // 3. Check missed defect commands
  const missedMatch = MISSED_DEFECT_PATTERN.exec(trimmed);
  if (missedMatch) {
    const path = missedMatch[1];
    const line = Number.parseInt(missedMatch[2]!, 10);
    const reasonText = missedMatch[3]?.trim();
    return {
      label: "missed_defect",
      line: Number.isNaN(line) ? undefined : line,
      path,
      reason: reasonText && reasonText.length > 0 ? reasonText : undefined,
    };
  }

  return undefined;
}

export function isDismissalFeedback(label: FeedbackLabel): boolean {
  return (
    label === "false_positive" ||
    label === "not_actionable" ||
    label === "duplicate" ||
    label === "thread_resolved"
  );
}

export function applyFeedbackToFindings(
  findings: readonly TrackedFinding[],
  feedbacks: readonly FindingFeedbackRecord[],
): readonly TrackedFinding[] {
  if (feedbacks.length === 0) return findings;

  const feedbacksByFingerprint = new Map<
    FindingFingerprint,
    FindingFeedbackRecord[]
  >();
  for (const feedback of feedbacks) {
    const list = feedbacksByFingerprint.get(feedback.fingerprint) ?? [];
    list.push(feedback);
    feedbacksByFingerprint.set(feedback.fingerprint, list);
  }

  return findings.map((finding) => {
    const relatedFeedbacks = feedbacksByFingerprint.get(finding.fingerprint);
    if (!relatedFeedbacks || relatedFeedbacks.length === 0) {
      return finding;
    }

    let status: FindingStatus = finding.status;
    let severity: FindingSeverity = finding.severity;

    for (const fb of relatedFeedbacks) {
      if (isDismissalFeedback(fb.label)) {
        status = "dismissed";
      } else if (fb.label === "wrong_severity" && fb.targetSeverity) {
        severity = fb.targetSeverity;
      }
    }

    if (status === finding.status && severity === finding.severity) {
      return finding;
    }

    return {
      ...finding,
      severity,
      status,
    };
  });
}
