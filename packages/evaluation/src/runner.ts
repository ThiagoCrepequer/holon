import { selectValidFindings } from "@holon/application";
import {
  modelReviewOutputSchema,
  type ReviewContextV2,
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
  readonly context: ReviewContextV2;
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
    readonly rejectedFindings: number;
    readonly severityMatches: number;
    readonly unexpectedFindings: number;
  };
  readonly passedCases: number;
  readonly subjectErrors: number;
  readonly schemaVersion: 1;
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
  return {
    caseId: evalCase.id,
    grade: gradeEvaluationCase(evalCase, {
      ...parsed.data,
      output: validatedOutput,
    }),
    outcome: "completed",
    rejectedFindings: parsed.data.output.findings.length - validFindings.length,
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
      precision:
        completed.length === 0
          ? null
          : metrics.actualFindings === 0
            ? 1
            : metrics.matchedFindings / metrics.actualFindings,
      recall:
        completed.length === 0
          ? null
          : metrics.expectedFindings === 0
            ? 1
            : metrics.matchedFindings / metrics.expectedFindings,
    },
    passedCases,
    schemaVersion: 1,
    subjectErrors: caseRuns.filter(
      (caseRun) => caseRun.outcome === "subject_error",
    ).length,
    totalCases: caseRuns.length,
  };
}
