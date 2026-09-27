import { describe, expect, it } from "vitest";

import {
  appendCiEvidenceToSummary,
  calculateChangedLinesCoverage,
  CI_EVIDENCE_MARKER_END,
  CI_EVIDENCE_MARKER_START,
  formatCiEvidenceMarkdown,
  formatLineIntervals,
  type CiEvidence,
  type LineCoverage,
} from "../src/index.js";

describe("ci-evidence domain logic", () => {
  it("handles empty changed lines correctly", () => {
    const result = calculateChangedLinesCoverage([], []);
    expect(result.coveragePercentage).toBe(100);
    expect(result.coveredLinesCount).toBe(0);
    expect(result.totalChangedLines).toBe(0);
    expect(result.uncoveredByFile).toEqual([]);
    expect(result.uncoveredLinesCount).toBe(0);
  });

  it("calculates changed line coverage with exact and suffix path matching", () => {
    const changedLines = [
      { line: 10, path: "packages/domain/src/user.ts", side: "RIGHT" as const },
      { line: 11, path: "packages/domain/src/user.ts", side: "RIGHT" as const },
      { line: 12, path: "packages/domain/src/user.ts", side: "RIGHT" as const },
      { line: 20, path: "src/payment.ts", side: "RIGHT" as const },
      { line: 21, path: "src/payment.ts", side: "RIGHT" as const },
      { line: 5, path: "src/untested.ts", side: "RIGHT" as const },
    ];

    const coverageReports: LineCoverage[] = [
      {
        hitsByLine: { 10: 5, 11: 0, 12: 1 },
        path: "packages/domain/src/user.ts",
        totalFound: 3,
        totalHit: 2,
      },
      {
        hitsByLine: { 20: 3, 21: 2 },
        path: "/home/runner/work/repo/repo/src/payment.ts", // absolute path suffix match
        totalFound: 2,
        totalHit: 2,
      },
    ];

    const result = calculateChangedLinesCoverage(changedLines, coverageReports);

    // user.ts has 10 (hit), 11 (miss), 12 (hit) -> 2 covered, 1 uncovered
    // payment.ts has 20 (hit), 21 (hit) -> 2 covered, 0 uncovered
    // untested.ts has 5 (miss, not in coverage) -> 0 covered, 1 uncovered
    // Total = 4 covered, 2 uncovered, total = 6 lines
    // 4 / 6 = 66.7%
    expect(result.totalChangedLines).toBe(6);
    expect(result.coveredLinesCount).toBe(4);
    expect(result.uncoveredLinesCount).toBe(2);
    expect(result.coveragePercentage).toBe(66.7);

    expect(result.uncoveredByFile).toEqual([
      { lines: [11], path: "packages/domain/src/user.ts" },
      { lines: [5], path: "src/untested.ts" },
    ]);
  });

  it("formats markdown for not_available status", () => {
    const evidence: CiEvidence = {
      status: "not_available",
    };

    const formatted = formatCiEvidenceMarkdown(evidence);
    expect(formatted).toContain(CI_EVIDENCE_MARKER_START);
    expect(formatted).toContain(CI_EVIDENCE_MARKER_END);
    expect(formatted).toContain(
      "CI test and coverage artifacts were not available",
    );
  });

  it("formats markdown with complete coverage, test reports, and failure details", () => {
    const evidence: CiEvidence = {
      source: "github-actions",
      status: "available",
      tests: {
        durationMs: 4500,
        failed: 1,
        failures: [
          {
            filePath: "test/example.test.ts",
            line: 42,
            message:
              "AssertionError: expected 1 to be 2\n  at test/example.test.ts:42",
            testName: "it handles edge cases",
          },
        ],
        passed: 20,
        skipped: 1,
        total: 22,
      },
      workflowName: "CI Test Gate",
      workflowRunId: 987654,
    };

    const changedCoverage = {
      coveragePercentage: 85.7,
      coveredLinesCount: 6,
      totalChangedLines: 7,
      uncoveredByFile: [{ lines: [15], path: "src/feature.ts" }],
      uncoveredLinesCount: 1,
    };

    const formatted = formatCiEvidenceMarkdown(evidence, changedCoverage);

    expect(formatted).toContain("### 🧪 CI Test & Coverage Evidence");
    expect(formatted).toContain(
      "- **Changed lines coverage**: 85.7% (6/7 lines covered)",
    );
    expect(formatted).toContain("`src/feature.ts`: lines 15");
    expect(formatted).toContain(
      "- **Test suite**: 20 passed, 1 failed, 1 skipped, 22 total (4.50s)",
    );
    expect(formatted).toContain("Failed tests (1)");
    expect(formatted).toContain(
      "**it handles edge cases** (`test/example.test.ts:42`): AssertionError: expected 1 to be 2",
    );
    expect(formatted).toContain("- **Source**: CI Test Gate (run #987654)");
  });

  it("formats markdown handling more than 5 uncovered files and 5 failures", () => {
    const evidence: CiEvidence = {
      status: "available",
      tests: {
        failed: 7,
        failures: Array.from({ length: 7 }, (_, i) => ({
          message: `Error in test ${i}`,
          testName: `test_${i}`,
        })),
        passed: 10,
        skipped: 0,
        total: 17,
      },
    };

    const changedCoverage = {
      coveragePercentage: 50,
      coveredLinesCount: 6,
      totalChangedLines: 12,
      uncoveredByFile: Array.from({ length: 7 }, (_, i) => ({
        lines: [i + 1],
        path: `src/file_${i}.ts`,
      })),
      uncoveredLinesCount: 6,
    };

    const formatted = formatCiEvidenceMarkdown(evidence, changedCoverage);
    expect(formatted).toContain("...and 2 more files with uncovered lines.");
    expect(formatted).toContain("...and 2 more failed tests.");
  });

  it("appends and updates CI evidence section in review summary", () => {
    const initialSummary = "Initial review summary from model.";
    const evidenceMarkdown = `${CI_EVIDENCE_MARKER_START}\n### 🧪 CI Evidence\n- **Coverage**: 100%\n${CI_EVIDENCE_MARKER_END}`;

    // Appending when none exists
    const updated = appendCiEvidenceToSummary(initialSummary, evidenceMarkdown);
    expect(updated).toBe(`${initialSummary}\n\n${evidenceMarkdown}`);

    // Updating when evidence block already exists
    const newEvidenceMarkdown = `${CI_EVIDENCE_MARKER_START}\n### 🧪 CI Evidence\n- **Coverage**: 90%\n${CI_EVIDENCE_MARKER_END}`;
    const reUpdated = appendCiEvidenceToSummary(updated, newEvidenceMarkdown);
    expect(reUpdated).toBe(`${initialSummary}\n\n${newEvidenceMarkdown}`);
  });

  it("ignores non-executable lines and non-source files in calculateChangedLinesCoverage", () => {
    const changedLines = [
      // Typescript source with instrumented line (20) and uninstrumented type/import line (21)
      { line: 20, path: "src/service.ts", side: "RIGHT" as const },
      { line: 21, path: "src/service.ts", side: "RIGHT" as const },
      // Documentation file (.md) - should be completely ignored
      { line: 1, path: "docs/readme.md", side: "RIGHT" as const },
      { line: 2, path: "docs/readme.md", side: "RIGHT" as const },
      // Config file (.json) - should be completely ignored
      { line: 5, path: "package.json", side: "RIGHT" as const },
    ];

    const coverageReports: LineCoverage[] = [
      {
        hitsByLine: { 20: 3 }, // line 21 has hitsByLine[21] === undefined (type/import/comment)
        path: "src/service.ts",
        totalFound: 1,
        totalHit: 1,
      },
    ];

    const result = calculateChangedLinesCoverage(changedLines, coverageReports);

    // Only line 20 is an executable line in a testable source file
    // Line 21 is non-executable (hits === undefined), docs/readme.md and package.json are non-source files
    expect(result.totalChangedLines).toBe(1);
    expect(result.coveredLinesCount).toBe(1);
    expect(result.uncoveredLinesCount).toBe(0);
    expect(result.coveragePercentage).toBe(100);
    expect(result.uncoveredByFile).toEqual([]);
  });

  it("formats line numbers into compact intervals with formatLineIntervals", () => {
    expect(formatLineIntervals([])).toBe("");
    expect(formatLineIntervals([5])).toBe("5");
    expect(formatLineIntervals([1, 2, 3, 4, 5])).toBe("1–5");
    expect(formatLineIntervals([1, 2, 3, 5, 7, 8, 9, 20])).toBe(
      "1–3, 5, 7–9, 20",
    );
    // Truncation when exceeding maxRanges
    const manyRanges = [1, 3, 5, 7, 9, 11, 13, 14, 15]; // 7 ranges: 1, 3, 5, 7, 9, 11, 13-15
    const formatted = formatLineIntervals(manyRanges, 4);
    expect(formatted).toContain("1, 3, 5, 7");
    expect(formatted).toContain("more lines");
  });
});

it("covers remaining formatting branches for failure locations and workflow sources", () => {
  // Failure with filePath only (no line)
  const evidence1: CiEvidence = {
    status: "available",
    tests: {
      failed: 2,
      failures: [
        {
          filePath: "test/file.test.ts",
          message: "File failure without line",
          testName: "file test",
        },
        {
          message: "Global failure without filePath",
          testName: "global test",
        },
      ],
      passed: 1,
      skipped: 0,
      total: 3,
    },
    workflowRunId: 112233, // workflowRunId without workflowName
  };

  const formatted1 = formatCiEvidenceMarkdown(evidence1);
  expect(formatted1).toContain("(`test/file.test.ts`)");
  expect(formatted1).toContain(
    "**global test**: Global failure without filePath",
  );
  expect(formatted1).toContain("- **Source**: CI Workflow (run #112233)");

  // WorkflowName without workflowRunId
  const evidence2: CiEvidence = {
    status: "available",
    workflowName: "Custom Actions",
  };
  const formatted2 = formatCiEvidenceMarkdown(evidence2);
  expect(formatted2).toContain("- **Source**: Custom Actions");

  // Replace marker when evidence starts at the beginning of summary and has text after
  const summaryStartingWithMarker = `${CI_EVIDENCE_MARKER_START}\nOld evidence\n${CI_EVIDENCE_MARKER_END}\n\nFooter note`;
  const replaced = appendCiEvidenceToSummary(
    summaryStartingWithMarker,
    "New Evidence",
  );
  expect(replaced).toBe("New Evidence\n\nFooter note");
});
