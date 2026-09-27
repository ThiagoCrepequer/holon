import { redactSecrets } from "./redaction.js";
export interface LineCoverage {
  readonly hitsByLine: Readonly<Record<number, number>>;
  readonly path: string;
  readonly totalFound: number;
  readonly totalHit: number;
}

export interface TestFailure {
  readonly filePath?: string | undefined;
  readonly line?: number | undefined;
  readonly message: string;
  readonly testName: string;
}

export interface TestExecutionReport {
  readonly durationMs?: number | undefined;
  readonly failed: number;
  readonly failures: readonly TestFailure[];
  readonly passed: number;
  readonly skipped: number;
  readonly total: number;
}

export type CiEvidenceStatus = "available" | "partial" | "not_available";

export interface CiEvidence {
  readonly coverage?: readonly LineCoverage[] | undefined;
  readonly limitations?: readonly string[] | undefined;
  readonly source?: string | undefined;
  readonly status: CiEvidenceStatus;
  readonly tests?: TestExecutionReport | undefined;
  readonly workflowName?: string | undefined;
  readonly workflowRunId?: number | undefined;
}

export interface UncoveredFileDetails {
  readonly lines: readonly number[];
  readonly path: string;
}

export interface ChangedLinesCoverageResult {
  readonly coveragePercentage: number;
  readonly coveredLinesCount: number;
  readonly totalChangedLines: number;
  readonly uncoveredByFile: readonly UncoveredFileDetails[];
  readonly uncoveredLinesCount: number;
}

export interface ChangedLineInput {
  readonly line: number;
  readonly path: string;
  readonly side: "RIGHT";
}

function normalizePathForMatching(path: string): string {
  return path.replace(/^[./\\]+/u, "").replace(/\\/gu, "/");
}

function findCoverageForPath(
  path: string,
  coverageReports: readonly LineCoverage[],
): LineCoverage | undefined {
  const normalizedTarget = normalizePathForMatching(path);

  const exact = coverageReports.filter(
    (c) => normalizePathForMatching(c.path) === normalizedTarget,
  );
  const matches = exact.length
    ? exact
    : coverageReports.filter((c) =>
        normalizePathForMatching(c.path).endsWith("/" + normalizedTarget),
      );
  if (
    !matches.length ||
    new Set(matches.map((c) => normalizePathForMatching(c.path))).size > 1
  )
    return undefined;
  const hitsByLine: Record<number, number> = {};
  for (const report of matches)
    for (const [line, hits] of Object.entries(report.hitsByLine))
      hitsByLine[Number(line)] = Math.max(hitsByLine[Number(line)] ?? 0, hits);
  return {
    path,
    hitsByLine,
    totalFound: Object.keys(hitsByLine).length,
    totalHit: Object.values(hitsByLine).filter((h) => h > 0).length,
  };
}

const SOURCE_CODE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cjs",
  "cpp",
  "cs",
  "go",
  "java",
  "js",
  "jsx",
  "kt",
  "mjs",
  "php",
  "py",
  "rb",
  "rs",
  "swift",
  "ts",
  "tsx",
]);

function isTestableSourceFile(path: string): boolean {
  const parts = path.split(".");
  if (parts.length < 2) return false;
  const ext = parts[parts.length - 1]?.toLowerCase() ?? "";
  return SOURCE_CODE_EXTENSIONS.has(ext);
}

/**
 * Formats an array of sorted line numbers into compact ranges.
 * E.g., [1, 2, 3, 5, 7, 8, 9] => "1–3, 5, 7–9"
 */
export function formatLineIntervals(
  lines: readonly number[],
  maxRanges = 6,
): string {
  if (lines.length === 0) return "";
  const sorted = [...new Set(lines)].toSorted((a, b) => a - b);
  const ranges: string[] = [];

  let start = sorted[0]!;
  let end = start;

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]!;
    if (current === end + 1) {
      end = current;
    } else {
      ranges.push(start === end ? `${start}` : `${start}–${end}`);
      start = current;
      end = current;
    }
  }
  ranges.push(start === end ? `${start}` : `${start}–${end}`);

  if (ranges.length <= maxRanges) {
    return ranges.join(", ");
  }

  const shown = ranges.slice(0, maxRanges).join(", ");
  const displayedLineCount = ranges.slice(0, maxRanges).reduce((acc, r) => {
    const parts = r.split("–");
    return (
      acc + (parts.length === 2 ? Number(parts[1]) - Number(parts[0]) + 1 : 1)
    );
  }, 0);
  const remainingCount = sorted.length - displayedLineCount;

  return `${shown} (...and ${remainingCount} more lines)`;
}

/**
 * Pure function: calculates the test execution coverage specifically on the lines
 * changed in the Pull Request (side RIGHT).
 */
export function calculateChangedLinesCoverage(
  changedLines: readonly ChangedLineInput[],
  coverageReports: readonly LineCoverage[],
): ChangedLinesCoverageResult {
  if (changedLines.length === 0) {
    return {
      coveragePercentage: 100,
      coveredLinesCount: 0,
      totalChangedLines: 0,
      uncoveredByFile: [],
      uncoveredLinesCount: 0,
    };
  }

  // Group changed lines by file
  const linesByFile = new Map<string, number[]>();
  for (const item of changedLines) {
    const existing = linesByFile.get(item.path);
    if (existing) {
      existing.push(item.line);
    } else {
      linesByFile.set(item.path, [item.line]);
    }
  }

  let coveredCount = 0;
  let uncoveredCount = 0;
  const uncoveredByFile: UncoveredFileDetails[] = [];

  for (const [path, lines] of linesByFile.entries()) {
    const coverage = findCoverageForPath(path, coverageReports);
    const uncoveredInFile: number[] = [];

    // Sort line numbers ascending
    const sortedLines = [...new Set(lines)].toSorted((a, b) => a - b);

    if (!coverage) {
      // If the file is not a testable source file (e.g. docs, configs, manifests), ignore it
      if (!isTestableSourceFile(path)) {
        continue;
      }
      // Source file without any coverage report: all lines are uncovered
      for (const line of sortedLines) {
        uncoveredCount++;
        uncoveredInFile.push(line);
      }
    } else {
      for (const line of sortedLines) {
        const hits = coverage.hitsByLine[line];
        // In LCOV, lines without DA: entries are non-executable declarations (imports, interfaces, types, comments, whitespace).
        // They must NOT be counted as executable code lines.
        if (hits === undefined) {
          continue;
        }
        if (hits > 0) {
          coveredCount++;
        } else {
          uncoveredCount++;
          uncoveredInFile.push(line);
        }
      }
    }

    if (uncoveredInFile.length > 0) {
      uncoveredByFile.push({
        lines: uncoveredInFile,
        path,
      });
    }
  }

  const total = coveredCount + uncoveredCount;
  const percentage =
    total > 0 ? Number(((coveredCount / total) * 100).toFixed(1)) : 100;

  return {
    coveragePercentage: percentage,
    coveredLinesCount: coveredCount,
    totalChangedLines: total,
    uncoveredByFile,
    uncoveredLinesCount: uncoveredCount,
  };
}

export const CI_EVIDENCE_MARKER_START = "<!-- holon:ci-evidence:start -->";
export const CI_EVIDENCE_MARKER_END = "<!-- holon:ci-evidence:end -->";

/**
 * Pure function: formats the CI Test & Coverage Evidence markdown section.
 */
export function formatCiEvidenceMarkdown(
  evidence: CiEvidence,
  changedLinesCoverage?: ChangedLinesCoverageResult,
): string {
  const lines: string[] = [];

  lines.push(CI_EVIDENCE_MARKER_START);
  lines.push("---");
  lines.push("### 🧪 CI Test & Coverage Evidence");

  if (evidence.status === "not_available") {
    lines.push(
      "*CI test and coverage artifacts were not available for this run.*",
    );
    lines.push(CI_EVIDENCE_MARKER_END);
    return lines.join("\n");
  }

  if (
    changedLinesCoverage !== undefined &&
    changedLinesCoverage.totalChangedLines > 0
  ) {
    const { coveragePercentage, coveredLinesCount, totalChangedLines } =
      changedLinesCoverage;
    lines.push(
      `- **Changed lines coverage**: ${coveragePercentage}% (${coveredLinesCount}/${totalChangedLines} lines covered)`,
    );

    if (changedLinesCoverage.uncoveredByFile.length > 0) {
      lines.push("  - **Uncovered lines**:");
      for (const item of changedLinesCoverage.uncoveredByFile.slice(0, 5)) {
        const lineStr = formatLineIntervals(item.lines);
        lines.push(`    - \`${safeCiText(item.path)}\`: lines ${lineStr}`);
      }
      if (changedLinesCoverage.uncoveredByFile.length > 5) {
        lines.push(
          `    - *...and ${changedLinesCoverage.uncoveredByFile.length - 5} more files with uncovered lines.*`,
        );
      }
    }
  }

  if (evidence.tests !== undefined) {
    const { durationMs, failed, passed, skipped, total } = evidence.tests;
    const durationStr =
      durationMs !== undefined ? ` (${(durationMs / 1000).toFixed(2)}s)` : "";
    lines.push(
      `- **Test suite**: ${passed} passed, ${failed} failed, ${skipped} skipped, ${total} total${durationStr}`,
    );

    if (evidence.tests.failures.length > 0) {
      lines.push(`  - **Failed tests (${evidence.tests.failures.length})**:`);
      for (const failure of evidence.tests.failures.slice(0, 5)) {
        const location =
          failure.filePath && failure.line
            ? ` (\`${safeCiText(failure.filePath)}:${failure.line}\`)`
            : failure.filePath
              ? ` (\`${safeCiText(failure.filePath)}\`)`
              : "";
        const cleanMessage = safeCiText(
          failure.message.split("\n")[0] || "Test failed",
        );
        lines.push(
          `    - **${safeCiText(failure.testName)}**${location}: ${cleanMessage}`,
        );
      }
      if (evidence.tests.failures.length > 5) {
        lines.push(
          `    - *...and ${evidence.tests.failures.length - 5} more failed tests.*`,
        );
      }
    }
  }

  for (const limitation of evidence.limitations ?? [])
    lines.push(`- **Limitation**: ${safeCiText(limitation)}`);

  if (evidence.workflowName || evidence.workflowRunId) {
    const nameStr = evidence.workflowName ?? "CI Workflow";
    const runStr = evidence.workflowRunId
      ? ` (run #${evidence.workflowRunId})`
      : "";
    lines.push(`- **Source**: ${safeCiText(nameStr)}${runStr}`);
  }

  lines.push(CI_EVIDENCE_MARKER_END);
  return lines.join("\n");
}

/**
 * Pure function: appends or replaces the CI Evidence section in the review summary markdown.
 */
export function appendCiEvidenceToSummary(
  originalSummary: string,
  evidenceMarkdown: string,
): string {
  const startIndex = originalSummary.indexOf(CI_EVIDENCE_MARKER_START);
  const endIndex = originalSummary.indexOf(CI_EVIDENCE_MARKER_END);

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const before = originalSummary.slice(0, startIndex).trimEnd();
    const after = originalSummary
      .slice(endIndex + CI_EVIDENCE_MARKER_END.length)
      .trimStart();
    return before
      ? `${before}\n\n${evidenceMarkdown}${after ? `\n\n${after}` : ""}`
      : `${evidenceMarkdown}${after ? `\n\n${after}` : ""}`;
  }

  return `${originalSummary.trimEnd()}\n\n${evidenceMarkdown}`;
}

/* eslint-disable no-control-regex -- Strip terminal escapes and control bytes in untrusted CI text. */
function safeCiText(raw: string): string {
  const plain = raw
    .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07))/gu, "")
    .replace(/[\x00-\x1f\x7f]/gu, " ");
  return redactSecrets(plain)
    .slice(0, 500)
    .replace(/[\\`*_[\]{}()#!|>]/gu, "\\$&")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/* eslint-enable no-control-regex */
