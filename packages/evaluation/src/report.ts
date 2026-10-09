import type { EvalSuiteResult } from "./runner.js";

export interface EvaluationReport {
  readonly sourceRevision: string;
  readonly suite: EvalSuiteResult;
}

export function createEvaluationReport(
  suite: EvalSuiteResult,
  sourceRevision: string,
): EvaluationReport {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(sourceRevision)) {
    throw new TypeError("evaluation source revision is invalid");
  }
  return { sourceRevision, suite };
}

function percentage(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(2)}%`;
}

export function renderEvaluationSummary(report: EvaluationReport): string {
  const { suite } = report;
  const rows = suite.caseRuns.map((caseRun) => {
    const failures =
      caseRun.outcome === "completed"
        ? caseRun.grade.failures.map((failure) => failure.kind).join(", ")
        : (caseRun.reason ?? caseRun.outcome);
    return `| \`${caseRun.caseId}\` | ${caseRun.outcome} | ${failures || "none"} |`;
  });
  return [
    "# Holon evaluation",
    "",
    `- Source revision: \`${report.sourceRevision}\``,
    `- Mode: \`${suite.configuration.mode}\``,
    `- Corpus: \`${suite.configuration.corpusVersion}\``,
    `- Subject: \`${suite.configuration.subjectVersion}\``,
    `- Model: \`${suite.configuration.modelReference ?? "none"}\``,
    `- Passed cases: ${suite.passedCases}/${suite.totalCases}`,
    `- Precision: ${percentage(suite.metrics.precision)}`,
    `- Recall: ${percentage(suite.metrics.recall)}`,
    `- Raw candidate precision/recall: ${percentage(suite.metrics.rawPrecision)} / ${percentage(suite.metrics.rawRecall)}`,
    `- Published precision: ${percentage(suite.metrics.publishedPrecision)}`,
    `- Recall conditional on completed cases: ${percentage(suite.metrics.completedRecall)}`,
    `- Rejected findings: ${suite.metrics.rejectedFindings}`,
    "",
    "| Case | Outcome | Failures |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}
