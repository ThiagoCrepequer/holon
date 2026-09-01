import type { EvaluationReport } from "./report.js";

export interface HarnessAggregate {
  readonly completedCases: number;
  readonly durationMs: number | null;
  readonly inputTokens: number | null;
  readonly invalidOutputs: number;
  readonly outputTokens: number | null;
  readonly passedCases: number;
  readonly precision: number | null;
  readonly recall: number | null;
  readonly subject: string;
  readonly subjectErrors: number;
  readonly toolCalls: number | null;
  readonly totalCases: number;
  readonly trials: number;
}

export interface HarnessComparisonReport {
  readonly aggregates: readonly HarnessAggregate[];
  readonly schemaVersion: 1;
  readonly sourceRevision: string;
  readonly suites: readonly EvaluationReport[];
}

function sumTelemetry(
  report: EvaluationReport,
  select: (
    attempt: NonNullable<
      Extract<
        (typeof report.suite.caseRuns)[number],
        { outcome: "completed" }
      >["telemetry"]
    >["attempts"][number],
  ) => number | undefined,
): number | null {
  let total = 0;
  let observed = false;
  for (const caseRun of report.suite.caseRuns) {
    if (caseRun.outcome !== "completed" || caseRun.telemetry === undefined)
      continue;
    for (const attempt of caseRun.telemetry.attempts) {
      const value = select(attempt);
      if (value === undefined) continue;
      observed = true;
      total += value;
    }
  }
  return observed ? total : null;
}

function sumOptional(values: readonly (number | null)[]): number | null {
  let total = 0;
  let observed = false;
  for (const value of values) {
    if (value === null) continue;
    observed = true;
    total += value;
  }
  return observed ? total : null;
}

function ratio(
  numerator: number,
  denominator: number,
  completedCases: number,
): number | null {
  if (completedCases === 0) return null;
  return denominator === 0 ? 1 : numerator / denominator;
}

export function createHarnessComparisonReport(
  suites: readonly EvaluationReport[],
  sourceRevision: string,
): HarnessComparisonReport {
  if (suites.length < 2) {
    throw new TypeError("harness comparison requires at least two subjects");
  }
  const subjects = suites.map(
    (report) => report.suite.configuration.subjectVersion,
  );
  const uniqueSubjects = [...new Set(subjects)];
  if (uniqueSubjects.length < 2) {
    throw new TypeError("harness comparison requires at least two subjects");
  }
  if (suites.some((report) => report.sourceRevision !== sourceRevision)) {
    throw new TypeError("harness comparison revisions must match");
  }
  const trialsBySubject = uniqueSubjects.map((subject) => ({
    reports: suites.filter(
      (report) => report.suite.configuration.subjectVersion === subject,
    ),
    subject,
  }));
  const trialCounts = new Set(
    trialsBySubject.map(({ reports }) => reports.length),
  );
  if (trialCounts.size !== 1) {
    throw new TypeError("harness comparison subjects must have equal trials");
  }
  return {
    aggregates: trialsBySubject.map(({ reports, subject }) => {
      const completedCases = reports.reduce(
        (total, report) => total + report.suite.completedCases,
        0,
      );
      const actualFindings = reports.reduce(
        (total, report) => total + report.suite.metrics.actualFindings,
        0,
      );
      const expectedFindings = reports.reduce(
        (total, report) => total + report.suite.metrics.expectedFindings,
        0,
      );
      const matchedFindings = reports.reduce(
        (total, report) => total + report.suite.metrics.matchedFindings,
        0,
      );
      return {
        completedCases,
        durationMs: sumOptional(
          reports.map((report) =>
            report.suite.caseRuns.reduce<number | null>(
              (total, caseRun) =>
                caseRun.outcome === "completed" &&
                caseRun.telemetry !== undefined
                  ? (total ?? 0) + caseRun.telemetry.durationMs
                  : total,
              null,
            ),
          ),
        ),
        inputTokens: sumOptional(
          reports.map((report) =>
            sumTelemetry(report, (attempt) => attempt.inputTokens),
          ),
        ),
        invalidOutputs: reports.reduce(
          (total, report) => total + report.suite.invalidOutputs,
          0,
        ),
        outputTokens: sumOptional(
          reports.map((report) =>
            sumTelemetry(report, (attempt) => attempt.outputTokens),
          ),
        ),
        passedCases: reports.reduce(
          (total, report) => total + report.suite.passedCases,
          0,
        ),
        precision: ratio(matchedFindings, actualFindings, completedCases),
        recall: ratio(matchedFindings, expectedFindings, completedCases),
        subject,
        subjectErrors: reports.reduce(
          (total, report) => total + report.suite.subjectErrors,
          0,
        ),
        toolCalls: sumOptional(
          reports.map((report) =>
            sumTelemetry(report, (attempt) => attempt.toolCallCount),
          ),
        ),
        totalCases: reports.reduce(
          (total, report) => total + report.suite.totalCases,
          0,
        ),
        trials: reports.length,
      };
    }),
    schemaVersion: 1,
    sourceRevision,
    suites,
  };
}

function numberOrNA(value: number | null): string {
  return value === null ? "n/a" : String(value);
}

function percentage(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(2)}%`;
}

export function renderHarnessComparisonSummary(
  report: HarnessComparisonReport,
): string {
  const failureRows = report.aggregates.flatMap((aggregate) => {
    const counts = new Map<string, number>();
    for (const suite of report.suites) {
      if (suite.suite.configuration.subjectVersion !== aggregate.subject)
        continue;
      for (const caseRun of suite.suite.caseRuns) {
        if (caseRun.outcome !== "subject_error") continue;
        const reason = caseRun.reason ?? "unknown";
        counts.set(reason, (counts.get(reason) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right, "en"))
      .map(
        ([reason, count]) =>
          `| \`${aggregate.subject}\` | \`${reason}\` | ${count} |`,
      );
  });
  return [
    "# Holon harness comparison",
    "",
    `- Source revision: \`${report.sourceRevision}\``,
    "- Interpret completion, quality, tokens and latency together; this report does not select a winner automatically.",
    "",
    "| Subject | Trials | Passed | Completed | Precision | Recall | Invalid | Subject errors | Input tokens | Output tokens | Tool calls | Duration ms |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...report.aggregates.map(
      (aggregate) =>
        `| \`${aggregate.subject}\` | ${aggregate.trials} | ${aggregate.passedCases}/${aggregate.totalCases} | ${aggregate.completedCases}/${aggregate.totalCases} | ${percentage(aggregate.precision)} | ${percentage(aggregate.recall)} | ${aggregate.invalidOutputs} | ${aggregate.subjectErrors} | ${numberOrNA(aggregate.inputTokens)} | ${numberOrNA(aggregate.outputTokens)} | ${numberOrNA(aggregate.toolCalls)} | ${numberOrNA(aggregate.durationMs)} |`,
    ),
    "",
    "## Subject failure reasons",
    "",
    ...(failureRows.length === 0
      ? ["- None."]
      : [
          "| Subject | Reason | Count |",
          "| --- | --- | ---: |",
          ...failureRows,
        ]),
    "",
  ].join("\n");
}
