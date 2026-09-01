import type { CheckRunConclusion, CheckRunOutput } from "@holon/contracts";
import type { Finding } from "@holon/domain";

export interface CheckRunFormattingOptions {
  readonly durationMs?: number | undefined;
  readonly fileCount?: number | undefined;
  readonly findings: readonly Finding[];
  readonly partial?: boolean | undefined;
  readonly summary: string;
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
  const { durationMs, fileCount, findings, partial, summary } = options;
  const findingCount = findings.length;

  let title = "Holon Review";
  if (findingCount === 0 && !partial) {
    title = "Holon Review — No regressions found";
  } else if (findingCount > 0) {
    title = `Holon Review — ${findingCount} finding${findingCount === 1 ? "" : "s"} identified`;
  } else if (partial) {
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
  if (partial) {
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
