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

  // Exact match
  const exact = coverageReports.find(
    (c) => normalizePathForMatching(c.path) === normalizedTarget,
  );
  if (exact) return exact;

  // Suffix match for cases where coverage paths include absolute repository roots
  return coverageReports.find((c) => {
    const norm = normalizePathForMatching(c.path);
    return (
      norm.endsWith("/" + normalizedTarget) ||
      normalizedTarget.endsWith("/" + norm)
    );
  });
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

    for (const line of sortedLines) {
      if (!coverage) {
        uncoveredCount++;
        uncoveredInFile.push(line);
        continue;
      }

      const hits = coverage.hitsByLine[line];
      if (hits !== undefined && hits > 0) {
        coveredCount++;
      } else {
        uncoveredCount++;
        uncoveredInFile.push(line);
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
        const lineStr = item.lines.join(", ");
        lines.push(`    - \`${item.path}\`: lines ${lineStr}`);
      }
      if (changedLinesCoverage.uncoveredByFile.length > 5) {
        lines.push(
          `    - *...and ${changedLinesCoverage.uncoveredByFile.length - 5} more files with uncovered lines.*`,
        );
      }
    }
  }

  if (evidence.tests !== undefined) {
    const { durationMs, failed, passed, total } = evidence.tests;
    const durationStr =
      durationMs !== undefined ? ` (${(durationMs / 1000).toFixed(2)}s)` : "";
    lines.push(
      `- **Test suite**: ${passed} passed, ${failed} failed, ${total} total${durationStr}`,
    );

    if (evidence.tests.failures.length > 0) {
      lines.push(`  - **Failed tests (${evidence.tests.failures.length})**:`);
      for (const failure of evidence.tests.failures.slice(0, 5)) {
        const location =
          failure.filePath && failure.line
            ? ` (\`${failure.filePath}:${failure.line}\`)`
            : failure.filePath
              ? ` (\`${failure.filePath}\`)`
              : "";
        const cleanMessage = failure.message.split("\n")[0] ?? "Test failed";
        lines.push(`    - **${failure.testName}**${location}: ${cleanMessage}`);
      }
      if (evidence.tests.failures.length > 5) {
        lines.push(
          `    - *...and ${evidence.tests.failures.length - 5} more failed tests.*`,
        );
      }
    }
  }

  if (evidence.workflowName || evidence.workflowRunId) {
    const nameStr = evidence.workflowName ?? "CI Workflow";
    const runStr = evidence.workflowRunId
      ? ` (run #${evidence.workflowRunId})`
      : "";
    lines.push(`- **Source**: ${nameStr}${runStr}`);
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
