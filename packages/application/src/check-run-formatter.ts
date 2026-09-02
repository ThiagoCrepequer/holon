import type {
  CheckRunConclusion,
  CheckRunOutput,
  ReconciliationSummary,
} from "@holon/contracts";
import type { Finding, ReviewVerdict } from "@holon/domain";

export interface CheckRunFormattingOptions {
  readonly durationMs?: number | undefined;
  readonly fileCount?: number | undefined;
  readonly findings: readonly Finding[];
  readonly partial?: boolean | undefined;
  readonly reconciliation?: ReconciliationSummary | undefined;
  readonly scopeStatus?:
    | "complete"
    | "partial_by_policy"
    | "partial_by_failure"
    | "unsupported"
    | undefined;
  readonly shardsAnalyzed?: number | undefined;
  readonly summary: string;
  readonly totalShards?: number | undefined;
  readonly verdict?: ReviewVerdict | undefined;
}

export function determineCheckRunConclusion(
  findings: readonly Finding[],
  partial = false,
  verdict?: ReviewVerdict,
): CheckRunConclusion {
  if (verdict === "REQUEST_CHANGES") {
    return "failure";
  }
  if (verdict === "APPROVE") {
    return "success";
  }
  if (verdict === "COMMENT") {
    return "neutral";
  }
  if (findings.length === 0 && !partial) {
    return "success";
  }
  return "neutral";
}

export function formatCheckRunOutput(
  options: CheckRunFormattingOptions,
): CheckRunOutput {
  const {
    durationMs,
    fileCount,
    findings,
    partial,
    reconciliation,
    scopeStatus,
    summary,
    verdict,
  } = options;
  const findingCount = findings.length;
  const isPartial =
    partial === true ||
    scopeStatus === "partial_by_policy" ||
    scopeStatus === "partial_by_failure";

  let title = "Holon Review";
  if (verdict === "REQUEST_CHANGES") {
    title = `Holon Review — Changes requested (${findingCount} finding${findingCount === 1 ? "" : "s"})`;
  } else if (verdict === "APPROVE") {
    title =
      reconciliation !== undefined && reconciliation.resolvedCount > 0
        ? `Holon Review — Approved (${reconciliation.resolvedCount} resolved)`
        : "Holon Review — Approved";
  } else if (verdict === "COMMENT") {
    title = isPartial
      ? "Holon Review — Partial review completed"
      : scopeStatus === "unsupported"
        ? "Holon Review — No eligible files"
        : "Holon Review — Informational comment";
  } else if (scopeStatus === "unsupported") {
    title = "Holon Review — No eligible files";
  } else if (findingCount === 0 && !isPartial) {
    title = "Holon Review — No regressions found";
  } else if (findingCount > 0) {
    title = `Holon Review — ${findingCount} finding${findingCount === 1 ? "" : "s"} identified`;
  } else if (isPartial) {
    title = "Holon Review — Partial review completed";
  }

  const lines: string[] = [];
  lines.push(summary);
  lines.push("");

  const details: string[] = [];
  if (fileCount !== undefined) {
    details.push(`- **Files analyzed**: ${fileCount}`);
  }
  details.push(`- **Findings identified**: ${findingCount}`);
  if (reconciliation !== undefined) {
    details.push(
      `- **Lifecycle**: ${reconciliation.resolvedCount} resolved, ${reconciliation.persistentCount} persistent, ${reconciliation.newCount} new${reconciliation.reintroducedCount > 0 ? `, ${reconciliation.reintroducedCount} reintroduced` : ""}`,
    );
  }
  if (scopeStatus === "partial_by_failure") {
    details.push(
      "- **Scope**: Partial (some changes could not be analyzed due to an execution failure)",
    );
  } else if (scopeStatus === "partial_by_policy" || isPartial) {
    details.push(
      "- **Scope**: Partial (some files or patches exceeded deterministic limits)",
    );
  }
  if (durationMs !== undefined) {
    details.push(`- **Duration**: ${(durationMs / 1000).toFixed(2)}s`);
  }

  if (details.length > 0) {
    lines.push("### Review Details", ...details);
  }

  return {
    summary: lines.join("\n"),
    title,
  };
}
