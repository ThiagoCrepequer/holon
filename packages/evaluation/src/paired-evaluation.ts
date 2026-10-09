import type { EvalCase, EvalRunConfiguration } from "./contracts.js";
import {
  runEvaluationSuite,
  type EvaluationSubject,
  type EvalCaseRun,
} from "./runner.js";

const passed = (run: EvalCaseRun | undefined) =>
  run?.outcome === "completed" && run.grade.passed;

/** Run the same adjudicated cases and fixed policy through independently supplied subjects. */
export async function compareEvaluationSubjects(
  cases: readonly EvalCase[],
  subjects: readonly {
    readonly name: string;
    readonly run: EvaluationSubject;
  }[],
  configuration: EvalRunConfiguration,
) {
  if (
    subjects.length < 2 ||
    new Set(subjects.map((subject) => subject.name)).size !== subjects.length
  )
    throw new TypeError("Paired evaluation needs distinct subjects");
  const variants = [];
  for (const subject of subjects)
    variants.push({
      name: subject.name,
      suite: await runEvaluationSuite(cases, subject.run, {
        ...configuration,
        subjectVersion: subject.name,
      }),
    });
  const baseline = variants[0]!;
  return {
    variants,
    comparisons: variants.slice(1).map((variant) => ({
      name: variant.name,
      regressions: baseline.suite.caseRuns.flatMap((run, index) =>
        passed(run) && !passed(variant.suite.caseRuns[index])
          ? [run.caseId]
          : [],
      ),
      improvements: variant.suite.caseRuns.flatMap((run, index) =>
        passed(run) && !passed(baseline.suite.caseRuns[index])
          ? [run.caseId]
          : [],
      ),
    })),
  };
}
