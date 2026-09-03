import {
  aggregatedReviewResultSchema,
  type AggregatedReviewResult,
  type ReconciliationSummary,
  type ReviewFinding,
  type ReviewPlan,
  type ReviewScopeStatus,
  type ShardReviewResult,
  type StructuralImpactReport,
} from "@holon/contracts";
import {
  classifyFindingPublication,
  determineReviewVerdict,
  formatVerdictBadge,
  type Finding,
  type FindingSeverity,
  type ReviewVerdictPolicyOptions,
} from "@holon/domain";

import { selectFindingsWithCanonicalEvidence } from "./evidence.js";

export interface AggregateShardReviewOptions {
  readonly additionalFindings?: readonly ReviewFinding[] | undefined;
  readonly canonicalFindings?: readonly Finding[] | undefined;
  readonly reconciliation?: ReconciliationSummary | undefined;
  readonly structuralImpact?: StructuralImpactReport | undefined;
  readonly unifiedSummary?: string | undefined;
  readonly verdictPolicy?: ReviewVerdictPolicyOptions | undefined;
}

export function formatStructuralImpactSection(
  report: StructuralImpactReport,
): string {
  const parts: string[] = [];
  if (report.contractBreaks.length > 0) {
    parts.push(
      `- ⚠️ **Potential Contract Breaks**: ${report.contractBreaks.map((cb) => cb.description).join("; ")}`,
    );
  }
  if (report.changedSymbols.length > 0) {
    parts.push(
      `- 🔍 **Symbols Modified**: ${report.changedSymbols.length} (exported: ${report.changedSymbols.filter((s) => s.isExported).length})`,
    );
  }
  if (report.downstreamReferences.length > 0) {
    parts.push(
      `- 🌐 **Downstream Impact Radius**: ${report.totalDownstreamReferencesCount ?? report.downstreamReferences.length} reference(s) across repository outside PR`,
    );
  }
  if (report.testGaps.length > 0) {
    parts.push(
      `- 🧪 **Test Gaps**: ${report.testGaps.length} source file(s) modified without corresponding test file in PR`,
    );
  }
  if (report.repositoryScanTruncated === true) {
    parts.push(
      "- ⚠️ **Repository Scan**: bounded downstream inventory was partial; absence of references is inconclusive",
    );
  }
  if (parts.length === 0) return "";
  return ["### 🏛️ Structural Impact Analysis", ...parts].join("\n");
}

export function formatReconciliationSection(
  summary: ReconciliationSummary,
): string {
  const parts: string[] = [];
  if (summary.resolvedCount > 0) {
    parts.push(
      `- ✅ **${summary.resolvedCount}** issue(s) resolved from previous commits.`,
    );
  }
  if (summary.persistentCount > 0) {
    parts.push(
      `- ⚠️ **${summary.persistentCount}** issue(s) persistent and still unresolved.`,
    );
  }
  if (summary.newCount > 0) {
    parts.push(
      `- 🆕 **${summary.newCount}** new issue(s) detected in this commit.`,
    );
  }
  if (summary.reintroducedCount > 0) {
    parts.push(`- 🔁 **${summary.reintroducedCount}** issue(s) reintroduced.`);
  }
  if (summary.dismissedCount > 0) {
    parts.push(
      `- 🚫 **${summary.dismissedCount}** issue(s) dismissed by human feedback.`,
    );
  }
  if (parts.length === 0) return "";
  return ["### Finding Lifecycle (Re-review)", ...parts].join("\n");
}

const severityWeights: Record<FindingSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function findingDeduplicationKey(finding: ReviewFinding): string {
  const normalizedDiagnostic = finding.diagnostic.trim().toLowerCase();
  return `${finding.location.path}:${finding.location.line}:${finding.location.side}:${normalizedDiagnostic}`;
}

function compareFindings(left: Finding, right: Finding): number {
  const weightDiff =
    severityWeights[right.severity] - severityWeights[left.severity];
  if (weightDiff !== 0) return weightDiff;
  const pathDiff = left.location.path.localeCompare(right.location.path);
  if (pathDiff !== 0) return pathDiff;
  return left.location.line - right.location.line;
}

function limitSummary(value: string, maximumCodePoints = 4_000): string {
  const characters = Array.from(value);
  if (characters.length <= maximumCodePoints) return value;
  return `${characters.slice(0, maximumCodePoints - 1).join("")}…`;
}

export function aggregateShardReviews(
  plan: ReviewPlan,
  shardResults: readonly ShardReviewResult[],
  options: AggregateShardReviewOptions = {},
): AggregatedReviewResult {
  if (plan.scopeStatus === "unsupported") {
    const verdictDetails = determineReviewVerdict({
      findings: [],
      options: options.verdictPolicy,
      scopeStatus: "unsupported",
      shardsAnalyzed: 0,
      totalShards: 0,
    });
    return aggregatedReviewResultSchema.parse({
      findings: [],
      omissionReasons: plan.omissionReasons,
      scopeStatus: "unsupported",
      shardsAnalyzed: 0,
      summary:
        "No eligible changes were found after excluding binary, lock, generated, vendored, minified, and recognized sensitive files.",
      totalShards: 0,
      verdict: verdictDetails.verdict,
      verdictDetails,
    });
  }

  const omissionReasons = [...plan.omissionReasons];
  let scopeStatus: ReviewScopeStatus = plan.scopeStatus;
  let shardsAnalyzed = 0;

  const candidateFindings: ReviewFinding[] = [];
  candidateFindings.push(...(options.additionalFindings ?? []));
  const shardSummaries: string[] = [];

  for (const result of shardResults) {
    if (result.status === "failure") {
      scopeStatus = "partial_by_failure";
      omissionReasons.push(
        `Shard ${result.shardIndex + 1} (${result.shardId}) failed during analysis${
          result.errorReason ? `: ${result.errorReason}` : ""
        }.`,
      );
    } else {
      shardsAnalyzed += 1;
      candidateFindings.push(...result.findings);
      const trimmedSummary = result.summary.trim();
      if (trimmedSummary.length > 0) {
        shardSummaries.push(trimmedSummary);
      }
    }
  }

  // Deduplicate findings by location and diagnostic
  const dedupedFindingsMap = new Map<string, ReviewFinding>();
  for (const finding of candidateFindings) {
    const key = findingDeduplicationKey(finding);
    const existing = dedupedFindingsMap.get(key);
    if (existing === undefined || finding.confidence > existing.confidence) {
      dedupedFindingsMap.set(key, finding);
    }
  }

  // All files and changed lines across shards for host verification
  const allFiles = plan.shards.flatMap((shard) => shard.files);
  const allChangedLines = plan.shards.flatMap((shard) => shard.changedLines);
  const dedupedCandidates = Array.from(dedupedFindingsMap.values());

  const verifiedFindings = selectFindingsWithCanonicalEvidence(
    dedupedCandidates,
    {
      changedLines: allChangedLines,
      files: allFiles,
      schemaVersion: 2,
      surface: plan.shards.flatMap((shard) => shard.surface ?? []),
      truncated: scopeStatus !== "complete",
    },
  );

  const sortedFindings = (
    options.canonicalFindings ?? verifiedFindings
  ).toSorted(compareFindings);

  const isAnyShardDegraded = shardResults.some(
    (result) => result.isDegraded === true,
  );

  const verdictDetails = determineReviewVerdict({
    findings: sortedFindings,
    isDegraded: isAnyShardDegraded,
    options: options.verdictPolicy,
    scopeStatus,
    shardsAnalyzed,
    totalShards: plan.shards.length,
  });

  // Compose summary
  const summarySections: string[] = [
    formatVerdictBadge(verdictDetails.verdict),
  ];
  if (verdictDetails.reasons.length > 0) {
    summarySections.push(verdictDetails.reasons.join(" "));
  }

  if (
    options.unifiedSummary !== undefined &&
    options.unifiedSummary.trim().length > 0
  ) {
    summarySections.push(options.unifiedSummary.trim());
  } else if (shardSummaries.length === 0) {
    summarySections.push(
      "Holon reviewed the changes and found no functional regressions or contract breaks.",
    );
  } else {
    summarySections.push(shardSummaries.join("\n\n"));
  }

  if (scopeStatus === "partial_by_policy") {
    summarySections.push(
      "Partial review: at least one eligible patch or context section was omitted by a deterministic host budget.",
    );
  } else if (scopeStatus === "partial_by_failure") {
    summarySections.push(
      "Partial review: some changes could not be analyzed due to an execution failure.",
    );
  }

  const lowSeverity = sortedFindings.filter(
    (finding) => classifyFindingPublication(finding) === "summary_only",
  );
  if (lowSeverity.length > 0) {
    summarySections.push(
      [
        "Low-severity observations:",
        ...lowSeverity.map((finding) => `- ${finding.diagnostic}`),
      ].join("\n"),
    );
  }

  if (options.reconciliation !== undefined) {
    const reconSection = formatReconciliationSection(options.reconciliation);
    if (reconSection.length > 0) {
      summarySections.push(reconSection);
    }
  }

  if (options.structuralImpact !== undefined) {
    const structuralSection = formatStructuralImpactSection(
      options.structuralImpact,
    );
    if (structuralSection.length > 0) {
      summarySections.push(structuralSection);
    }
  }

  const finalSummary = limitSummary(summarySections.join("\n\n"));

  return aggregatedReviewResultSchema.parse({
    findings: sortedFindings.map((f) => ({
      confidence: f.confidence,
      diagnostic: f.diagnostic,
      evidence: f.evidence.map((e) => ({
        ...(e.endLine !== undefined ? { endLine: e.endLine } : {}),
        excerpt: e.excerpt,
        path: e.path,
        reason: e.reason,
        startLine: e.startLine,
      })),
      location: {
        line: f.location.line,
        path: f.location.path,
        side: f.location.side,
        ...(f.location.startLine !== undefined
          ? { startLine: f.location.startLine }
          : {}),
      },
      severity: f.severity,
      ...(f.suggestion !== undefined ? { suggestion: f.suggestion } : {}),
    })),
    ...(isAnyShardDegraded ? { isDegraded: true } : {}),
    omissionReasons,
    reconciliation: options.reconciliation,
    scopeStatus,
    shardsAnalyzed,
    summary: finalSummary,
    totalShards: plan.shards.length,
    verdict: verdictDetails.verdict,
    verdictDetails,
  });
}
