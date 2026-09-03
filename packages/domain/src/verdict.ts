import type { FindingSeverity } from "./finding.js";

export type ReviewVerdict = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export interface ReviewVerdictDetails {
  readonly advisoryFindingsCount: number;
  readonly blockingFindingsCount: number;
  readonly reasons: readonly string[];
  readonly riskScore: number;
  readonly verdict: ReviewVerdict;
}

export interface ReviewVerdictPolicyOptions {
  readonly allowApprove?: boolean | undefined;
  readonly blockingSeverities?: readonly FindingSeverity[] | undefined;
  readonly mediumHighConfidenceThreshold?: number | undefined;
  readonly mediumSeverityThreshold?: number | undefined;
  readonly minimumConfidenceThreshold?: number | undefined;
  readonly riskScoreThreshold?: number | undefined;
}

export interface DetermineReviewVerdictInput {
  readonly findings: readonly {
    readonly confidence: number;
    readonly severity: FindingSeverity;
  }[];
  readonly isDegraded?: boolean | undefined;
  readonly options?: ReviewVerdictPolicyOptions | undefined;
  readonly scopeStatus:
    | "complete"
    | "partial_by_policy"
    | "partial_by_failure"
    | "unsupported";
  readonly shardsAnalyzed?: number | undefined;
  readonly totalShards?: number | undefined;
}

const SEVERITY_WEIGHTS: Readonly<Record<FindingSeverity, number>> = {
  critical: 4.0,
  high: 3.0,
  medium: 1.5,
  low: 0.25,
};

const DEFAULT_OPTIONS = {
  allowApprove: true,
  mediumHighConfidenceThreshold: 0.85,
  mediumSeverityThreshold: 2,
  minimumConfidenceThreshold: 0.75,
  riskScoreThreshold: 2.0,
} as const;

export function determineReviewVerdict(
  input: DetermineReviewVerdictInput,
): ReviewVerdictDetails {
  const options = {
    allowApprove: input.options?.allowApprove ?? DEFAULT_OPTIONS.allowApprove,
    mediumHighConfidenceThreshold:
      input.options?.mediumHighConfidenceThreshold ??
      DEFAULT_OPTIONS.mediumHighConfidenceThreshold,
    mediumSeverityThreshold:
      input.options?.mediumSeverityThreshold ??
      DEFAULT_OPTIONS.mediumSeverityThreshold,
    minimumConfidenceThreshold:
      input.options?.minimumConfidenceThreshold ??
      DEFAULT_OPTIONS.minimumConfidenceThreshold,
    riskScoreThreshold:
      input.options?.riskScoreThreshold ?? DEFAULT_OPTIONS.riskScoreThreshold,
  };

  const reasons: string[] = [];

  // 1. Fail-Safe / Incomplete Scope Checks (COMMENT only)
  if (input.scopeStatus === "partial_by_policy") {
    reasons.push(
      "Review scope is partial due to exclusion policies or file budgets; cannot approve or request changes without complete context.",
    );
    return {
      advisoryFindingsCount: input.findings.length,
      blockingFindingsCount: 0,
      reasons,
      riskScore: 0,
      verdict: "COMMENT",
    };
  }

  if (input.scopeStatus === "partial_by_failure") {
    reasons.push(
      "Review was interrupted by shard execution failure; cannot approve or request changes without full analysis.",
    );
    return {
      advisoryFindingsCount: input.findings.length,
      blockingFindingsCount: 0,
      reasons,
      riskScore: 0,
      verdict: "COMMENT",
    };
  }

  if (input.scopeStatus === "unsupported") {
    reasons.push("Pull request contains no supported code changes.");
    return {
      advisoryFindingsCount: 0,
      blockingFindingsCount: 0,
      reasons,
      riskScore: 0,
      verdict: "COMMENT",
    };
  }

  if (
    input.shardsAnalyzed !== undefined &&
    input.totalShards !== undefined &&
    input.totalShards > 0 &&
    input.shardsAnalyzed < input.totalShards
  ) {
    reasons.push(
      `Incomplete shard execution (${input.shardsAnalyzed}/${input.totalShards} shards analyzed); review is incomplete.`,
    );
    return {
      advisoryFindingsCount: input.findings.length,
      blockingFindingsCount: 0,
      reasons,
      riskScore: 0,
      verdict: "COMMENT",
    };
  }

  // Filter confident findings
  const confidentFindings = input.findings.filter(
    (f) => f.confidence >= options.minimumConfidenceThreshold,
  );

  // If findings were emitted but all were low-confidence (< 0.75)
  if (input.findings.length > 0 && confidentFindings.length === 0) {
    reasons.push(
      `Detected ${input.findings.length} advisory observation(s), but all had confidence below the reliable threshold (${options.minimumConfidenceThreshold}).`,
    );
    return {
      advisoryFindingsCount: input.findings.length,
      blockingFindingsCount: 0,
      reasons,
      riskScore: 0,
      verdict: "COMMENT",
    };
  }

  // Calculate risk score
  const riskScore = confidentFindings.reduce(
    (acc, finding) => acc + (SEVERITY_WEIGHTS[finding.severity] ?? 0),
    0,
  );

  const criticalCount = confidentFindings.filter(
    (f) => f.severity === "critical",
  ).length;
  const highCount = confidentFindings.filter(
    (f) => f.severity === "high",
  ).length;
  const mediumConfidentCount = confidentFindings.filter(
    (f) => f.severity === "medium",
  ).length;
  const mediumHighConfidenceCount = confidentFindings.filter(
    (f) =>
      f.severity === "medium" &&
      f.confidence >= options.mediumHighConfidenceThreshold,
  ).length;
  const lowCount = input.findings.filter((f) => f.severity === "low").length;

  const hasBlockingCriticalOrHigh = criticalCount > 0 || highCount > 0;
  const hasMediumAccumulation =
    mediumConfidentCount >= options.mediumSeverityThreshold;
  const hasHighConfidenceMedium = mediumHighConfidenceCount > 0;
  const exceedsRiskScore = riskScore >= options.riskScoreThreshold;

  const isBlocking =
    hasBlockingCriticalOrHigh ||
    hasMediumAccumulation ||
    hasHighConfidenceMedium ||
    exceedsRiskScore;

  if (isBlocking) {
    const blockingCount =
      criticalCount +
      highCount +
      (hasMediumAccumulation || hasHighConfidenceMedium
        ? mediumConfidentCount
        : 0);

    if (criticalCount > 0) {
      reasons.push(
        `${criticalCount} critical defect(s) identified requiring resolution.`,
      );
    }
    if (highCount > 0) {
      reasons.push(
        `${highCount} high-severity defect(s) identified requiring resolution.`,
      );
    }
    if (mediumHighConfidenceCount > 0 && !hasMediumAccumulation) {
      reasons.push(
        `${mediumHighConfidenceCount} high-confidence moderate defect(s) identified requiring resolution.`,
      );
    } else if (hasMediumAccumulation) {
      reasons.push(
        `${mediumConfidentCount} moderate defects accumulated (threshold: ${options.mediumSeverityThreshold}), indicating significant code risk.`,
      );
    } else if (exceedsRiskScore && !hasBlockingCriticalOrHigh) {
      reasons.push(
        `Risk score ${riskScore.toFixed(1)} reached or exceeded threshold ${options.riskScoreThreshold.toFixed(1)}.`,
      );
    }

    return {
      advisoryFindingsCount: input.findings.length - blockingCount,
      blockingFindingsCount: blockingCount,
      reasons,
      riskScore,
      verdict: "REQUEST_CHANGES",
    };
  }

  // No blocking defects found: evaluate APPROVE vs COMMENT
  if (input.isDegraded === true) {
    reasons.push(
      "ℹ️ A análise do modelo foi concluída de forma não-estruturada. Revise as notas investigativas abaixo.",
    );
    return {
      advisoryFindingsCount: input.findings.length,
      blockingFindingsCount: 0,
      reasons,
      riskScore,
      verdict: "COMMENT",
    };
  }

  if (!options.allowApprove) {
    reasons.push(
      "No blocking defects found, but automated approvals are disabled by policy.",
    );
    return {
      advisoryFindingsCount: input.findings.length,
      blockingFindingsCount: 0,
      reasons,
      riskScore,
      verdict: "COMMENT",
    };
  }

  if (lowCount > 0) {
    reasons.push(
      `No blocking defects found. ${lowCount} low-severity advisory observation(s) provided for consideration.`,
    );
  } else {
    reasons.push(
      "All reviewed files clean; no defects or regressions identified.",
    );
  }

  return {
    advisoryFindingsCount: lowCount,
    blockingFindingsCount: 0,
    reasons,
    riskScore,
    verdict: "APPROVE",
  };
}

export function formatVerdictBadge(verdict: ReviewVerdict): string {
  switch (verdict) {
    case "APPROVE":
      return "### Verdict: Approved";
    case "REQUEST_CHANGES":
      return "### Verdict: Changes requested";
    case "COMMENT":
    default:
      return "### Verdict: Informational Comment";
  }
}
