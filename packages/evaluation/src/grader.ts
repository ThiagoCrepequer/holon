import type { ReviewFinding } from "@holon/contracts";

import type {
  EvalCase,
  EvalSubjectOutput,
  ExpectedFinding,
} from "./contracts.js";

export type EvalFailure =
  | { readonly kind: "evidence_integrity"; readonly rejectedCount: number }
  | { readonly findingId: string; readonly kind: "missing_finding" }
  | { readonly actualIndex: number; readonly kind: "unexpected_finding" }
  | {
      readonly actual: ReviewFinding["severity"];
      readonly expected: ReviewFinding["severity"];
      readonly findingId: string;
      readonly kind: "severity_mismatch";
    }
  | {
      readonly actual: number;
      readonly findingId: string;
      readonly kind: "confidence_below_minimum";
      readonly minimum: number;
    }
  | { readonly findingId: string; readonly kind: "missing_suggestion" }
  | {
      readonly actual: boolean;
      readonly expected: boolean;
      readonly kind: "partial_mismatch";
    }
  | { readonly kind: "forbidden_output_term"; readonly term: string }
  | { readonly kind: "missing_summary_term"; readonly term: string };

export interface EvalCaseMetrics {
  readonly actualFindings: number;
  readonly expectedFindings: number;
  readonly matchedFindings: number;
  readonly precision: number;
  readonly recall: number;
  readonly severityMatches: number;
  readonly unexpectedFindings: number;
}

export interface EvalGrade {
  readonly caseId: string;
  readonly failures: readonly EvalFailure[];
  readonly metrics: EvalCaseMetrics;
  readonly passed: boolean;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function containsAll(value: string, terms: readonly string[]): boolean {
  const normalized = normalize(value);
  return terms.every((term) => normalized.includes(normalize(term)));
}

function findingIdentityMatches(
  expected: ExpectedFinding,
  actual: ReviewFinding,
): boolean {
  const expectedStartLine =
    expected.location.startLine ?? expected.location.line;
  const actualStartLine = actual.location.startLine ?? actual.location.line;
  return (
    actual.location.path === expected.location.path &&
    actual.location.line === expected.location.line &&
    actual.location.side === expected.location.side &&
    actualStartLine === expectedStartLine &&
    containsAll(actual.diagnostic, expected.requiredDiagnosticTerms)
  );
}

function matchFindings(
  expected: readonly ExpectedFinding[],
  actual: readonly ReviewFinding[],
): {
  readonly pairs: readonly {
    readonly actualIndex: number;
    readonly expectedIndex: number;
  }[];
  readonly matchedExpected: ReadonlySet<number>;
  readonly matchedActual: ReadonlySet<number>;
} {
  const matches = expected.map((expectedFinding) =>
    actual.map((actualFinding) =>
      findingIdentityMatches(expectedFinding, actualFinding),
    ),
  );
  const actualToExpected = new Map<number, number>();
  const matchedExpected = new Set<number>();

  function assign(expectedIndex: number, visitedActual: Set<number>): boolean {
    for (const actualIndex of actual.keys()) {
      if (
        visitedActual.has(actualIndex) ||
        matches[expectedIndex]?.[actualIndex] !== true
      ) {
        continue;
      }
      visitedActual.add(actualIndex);
      const previousExpected = actualToExpected.get(actualIndex);
      if (
        previousExpected === undefined ||
        assign(previousExpected, visitedActual)
      ) {
        actualToExpected.set(actualIndex, expectedIndex);
        return true;
      }
    }
    return false;
  }

  for (const expectedIndex of expected.keys()) {
    if (assign(expectedIndex, new Set())) matchedExpected.add(expectedIndex);
  }
  const pairs = [...actualToExpected.entries()]
    .map(([actualIndex, expectedIndex]) => ({ actualIndex, expectedIndex }))
    .toSorted(
      (left, right) =>
        left.expectedIndex - right.expectedIndex ||
        left.actualIndex - right.actualIndex,
    );
  return {
    matchedActual: new Set(actualToExpected.keys()),
    matchedExpected,
    pairs,
  };
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return numerator === 0 ? 1 : 0;
  return numerator / denominator;
}

export function gradeEvaluationCase(
  evalCase: EvalCase,
  subjectOutput: EvalSubjectOutput,
): EvalGrade {
  const { matchedActual, matchedExpected, pairs } = matchFindings(
    evalCase.expected.findings,
    subjectOutput.output.findings,
  );
  const failures: EvalFailure[] = [];

  for (const [index, finding] of evalCase.expected.findings.entries()) {
    if (!matchedExpected.has(index)) {
      failures.push({ findingId: finding.id, kind: "missing_finding" });
    }
  }
  for (const index of subjectOutput.output.findings.keys()) {
    if (!matchedActual.has(index)) {
      failures.push({ actualIndex: index, kind: "unexpected_finding" });
    }
  }
  let severityMatches = 0;
  for (const pair of pairs) {
    const expected = evalCase.expected.findings[pair.expectedIndex];
    const actual = subjectOutput.output.findings[pair.actualIndex];
    if (expected === undefined || actual === undefined) {
      throw new TypeError("finding match references an unknown finding");
    }
    if (actual.severity === expected.severity) {
      severityMatches += 1;
    } else {
      failures.push({
        actual: actual.severity,
        expected: expected.severity,
        findingId: expected.id,
        kind: "severity_mismatch",
      });
    }
    if (
      expected.minimumConfidence !== undefined &&
      actual.confidence < expected.minimumConfidence
    ) {
      failures.push({
        actual: actual.confidence,
        findingId: expected.id,
        kind: "confidence_below_minimum",
        minimum: expected.minimumConfidence,
      });
    }
    if (expected.suggestionRequired && actual.suggestion === undefined) {
      failures.push({
        findingId: expected.id,
        kind: "missing_suggestion",
      });
    }
  }
  if (subjectOutput.partial !== evalCase.expected.partial) {
    failures.push({
      actual: subjectOutput.partial,
      expected: evalCase.expected.partial,
      kind: "partial_mismatch",
    });
  }
  for (const term of evalCase.expected.requiredSummaryTerms) {
    if (!containsAll(subjectOutput.output.summary, [term])) {
      failures.push({ kind: "missing_summary_term", term });
    }
  }

  const completeOutput = [
    subjectOutput.output.summary,
    ...subjectOutput.output.findings.flatMap((finding) => [
      finding.diagnostic,
      finding.suggestion ?? "",
    ]),
  ].join("\n");
  for (const term of evalCase.expected.forbiddenOutputTerms) {
    if (containsAll(completeOutput, [term])) {
      failures.push({ kind: "forbidden_output_term", term });
    }
  }

  const matchedFindings = matchedExpected.size;
  const actualFindings = subjectOutput.output.findings.length;
  const expectedFindings = evalCase.expected.findings.length;
  return {
    caseId: evalCase.id,
    failures,
    metrics: {
      actualFindings,
      expectedFindings,
      matchedFindings,
      precision: ratio(matchedFindings, actualFindings),
      recall: ratio(matchedFindings, expectedFindings),
      severityMatches,
      unexpectedFindings: actualFindings - matchedActual.size,
    },
    passed: failures.length === 0,
  };
}
