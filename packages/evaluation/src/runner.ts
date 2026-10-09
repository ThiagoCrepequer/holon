import { selectValidFindings } from "@holon/application";
import {
  modelReviewOutputSchema,
  type ReviewShardContext,
  type ReviewJob,
} from "@holon/contracts";

import {
  evalCaseSchema,
  evalRunConfigurationSchema,
  evalSubjectOutputSchema,
  type EvalCase,
  type EvalRunConfiguration,
  type EvalSubjectTelemetry,
  type EvaluationSubjectFailureReason,
} from "./contracts.js";
import { gradeEvaluationCase, type EvalGrade } from "./grader.js";

export interface EvaluationSubjectInput {
  readonly caseId: string;
  readonly context: ReviewShardContext;
  readonly job: ReviewJob;
}

export type EvaluationSubject = (
  input: EvaluationSubjectInput,
) => Promise<unknown>;

export class EvaluationSubjectError extends Error {
  public constructor(public readonly reason: EvaluationSubjectFailureReason) {
    super(`EVALUATION_SUBJECT:${reason}`);
    this.name = "EvaluationSubjectError";
  }
}

export type EvalCaseRun =
  | {
      readonly caseId: string;
      readonly grade: EvalGrade;
      readonly rawGrade: EvalGrade;
      readonly rawCandidates: number;
      readonly outcome: "completed";
      readonly rejectedFindings: number;
      readonly telemetry?: EvalSubjectTelemetry;
    }
  | {
      readonly caseId: string;
      readonly outcome: "invalid_output" | "subject_error";
      readonly reason?: EvaluationSubjectFailureReason;
    };

export interface EvalSuiteResult {
  readonly caseRuns: readonly EvalCaseRun[];
  readonly completedCases: number;
  readonly configuration: EvalRunConfiguration;
  readonly failedCases: number;
  readonly failedGrades: number;
  readonly invalidOutputs: number;
  readonly metrics: {
    readonly actualFindings: number;
    readonly expectedFindings: number;
    readonly matchedFindings: number;
    readonly precision: number | null;
    readonly recall: number | null;
    readonly rawCandidates: number;
    readonly rawPrecision: number | null;
    readonly rawRecall: number | null;
    readonly publishedPrecision: number | null;
    readonly completedRecall: number | null;
    readonly rejectedFindings: number;
    readonly severityMatches: number;
    readonly unexpectedFindings: number;
  };
  readonly passedCases: number;
  readonly subjectErrors: number;

  readonly totalCases: number;
}

function validateSuiteCases(cases: readonly EvalCase[]): readonly EvalCase[] {
  if (cases.length === 0) {
    throw new TypeError("evaluation suite must contain at least one case");
  }
  const parsed = cases.map((evalCase) => evalCaseSchema.parse(evalCase));
  const ids = parsed.map((evalCase) => evalCase.id);
  if (new Set(ids).size !== ids.length) {
    throw new TypeError("evaluation case ids must be unique within a suite");
  }
  return parsed;
}

async function runCase(
  evalCase: EvalCase,
  subject: EvaluationSubject,
): Promise<EvalCaseRun> {
  let candidate: unknown;
  try {
    candidate = await subject({ caseId: evalCase.id, ...evalCase.input });
  } catch (error) {
    return {
      caseId: evalCase.id,
      outcome: "subject_error",
      ...(error instanceof EvaluationSubjectError
        ? { reason: error.reason }
        : { reason: "unknown" as const }),
    };
  }

  const parsed = evalSubjectOutputSchema.safeParse(candidate);
  if (!parsed.success) {
    return { caseId: evalCase.id, outcome: "invalid_output" };
  }
  const validFindings = selectValidFindings(
    parsed.data.output.findings,
    evalCase.input.context,
  );
  const validatedOutput = modelReviewOutputSchema.parse({
    ...parsed.data.output,
    findings: validFindings,
  });
  const rejectedFindings =
    parsed.data.output.findings.length - validFindings.length;
  const grade = gradeEvaluationCase(evalCase, {
    ...parsed.data,
    output: validatedOutput,
  });
  return {
    caseId: evalCase.id,
    grade:
      rejectedFindings === 0
        ? grade
        : {
            ...grade,
            passed: false,
            failures: [
              ...grade.failures,
              { kind: "evidence_integrity", rejectedCount: rejectedFindings },
            ],
          },
    rawGrade: gradeEvaluationCase(evalCase, parsed.data),
    rawCandidates: parsed.data.output.findings.length,
    outcome: "completed",
    rejectedFindings,
    ...(parsed.data.telemetry === undefined
      ? {}
      : { telemetry: parsed.data.telemetry }),
  };
}

export async function runEvaluationSuite(
  cases: readonly EvalCase[],
  subject: EvaluationSubject,
  configuration: EvalRunConfiguration,
): Promise<EvalSuiteResult> {
  const validatedCases = validateSuiteCases(cases);
  const validatedConfiguration =
    evalRunConfigurationSchema.parse(configuration);
  const caseRuns: EvalCaseRun[] = [];
  for (const evalCase of validatedCases) {
    caseRuns.push(await runCase(evalCase, subject));
  }

  const completed = caseRuns.filter(
    (caseRun): caseRun is Extract<EvalCaseRun, { outcome: "completed" }> =>
      caseRun.outcome === "completed",
  );
  const passedCases = completed.filter(
    (caseRun) => caseRun.grade.passed,
  ).length;
  const metrics = completed.reduce(
    (total, caseRun) => ({
      actualFindings:
        total.actualFindings + caseRun.grade.metrics.actualFindings,
      expectedFindings:
        total.expectedFindings + caseRun.grade.metrics.expectedFindings,
      matchedFindings:
        total.matchedFindings + caseRun.grade.metrics.matchedFindings,
      rejectedFindings: total.rejectedFindings + caseRun.rejectedFindings,
      severityMatches:
        total.severityMatches + caseRun.grade.metrics.severityMatches,
      unexpectedFindings:
        total.unexpectedFindings + caseRun.grade.metrics.unexpectedFindings,
    }),
    {
      actualFindings: 0,
      expectedFindings: 0,
      matchedFindings: 0,
      rejectedFindings: 0,
      severityMatches: 0,
      unexpectedFindings: 0,
    },
  );
  const expectedFindings = validatedCases.reduce(
    (count, item) => count + item.expected.findings.length,
    0,
  );
  const rawCandidates = completed.reduce(
    (count, item) => count + item.rawCandidates,
    0,
  );
  const rawMatches = completed.reduce(
    (count, item) => count + item.rawGrade.metrics.matchedFindings,
    0,
  );
  const precision = (matches: number, count: number): number | null =>
    completed.length === 0 ? null : count === 0 ? 1 : matches / count;
  return {
    caseRuns,
    completedCases: completed.length,
    configuration: validatedConfiguration,
    failedCases: caseRuns.length - passedCases,
    failedGrades: completed.length - passedCases,
    invalidOutputs: caseRuns.filter(
      (caseRun) => caseRun.outcome === "invalid_output",
    ).length,
    metrics: {
      ...metrics,
      expectedFindings,
      rawCandidates,
      precision: precision(metrics.matchedFindings, rawCandidates),
      publishedPrecision: precision(
        metrics.matchedFindings,
        metrics.actualFindings,
      ),
      rawPrecision: precision(rawMatches, rawCandidates),
      rawRecall: expectedFindings === 0 ? 1 : rawMatches / expectedFindings,
      completedRecall:
        completed.length === 0
          ? null
          : metrics.expectedFindings === 0
            ? 1
            : metrics.matchedFindings / metrics.expectedFindings,
      recall:
        expectedFindings === 0 ? 1 : metrics.matchedFindings / expectedFindings,
    },
    passedCases,
    subjectErrors: caseRuns.filter(
      (caseRun) => caseRun.outcome === "subject_error",
    ).length,
    totalCases: caseRuns.length,
  };
}
