import type { CheckRunConclusion, CheckRunOutput } from "@holon/contracts";
import type { Finding } from "@holon/domain";

export interface CheckRunFormattingOptions {
  readonly durationMs?: number | undefined;
  readonly fileCount?: number | undefined;
  readonly findings: readonly Finding[];
  readonly partial?: boolean | undefined;
  readonly scopeStatus?:
    | "complete"
    | "partial_by_policy"
    | "partial_by_failure"
    | "unsupported"
    | undefined;
  readonly shardsAnalyzed?: number | undefined;
  readonly summary: string;
  readonly totalShards?: number | undefined;
}

export function determineCheckRunConclusion(
  findings: readonly Finding[],
  partial = false,
): CheckRunConclusion {
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
    scopeStatus,
    shardsAnalyzed,
    summary,
    totalShards,
  } = options;
  const findingCount = findings.length;
  const isPartial =
    partial === true ||
    scopeStatus === "partial_by_policy" ||
    scopeStatus === "partial_by_failure";

  let title = "Holon Review";
  if (scopeStatus === "unsupported") {
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
  if (shardsAnalyzed !== undefined && totalShards !== undefined) {
    details.push(`- **Batches (Shards)**: ${shardsAnalyzed}/${totalShards}`);
  }
  if (fileCount !== undefined) {
    details.push(`- **Files analyzed**: ${fileCount}`);
  }
  details.push(`- **Findings identified**: ${findingCount}`);
  if (scopeStatus === "partial_by_failure") {
    details.push(
      "- **Scope**: Partial (at least one shard encountered a model execution failure)",
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
