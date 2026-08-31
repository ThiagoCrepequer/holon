import { describe, expect, it } from "vitest";

import { evalSubjectOutputSchema, gradeEvaluationCase } from "../src/index.js";
import { createEvalCase, createPassingOutput } from "./fixtures.js";

describe("gradeEvaluationCase", () => {
  it("passes a finding that satisfies the deterministic oracle", () => {
    const grade = gradeEvaluationCase(
      createEvalCase(),
      evalSubjectOutputSchema.parse(createPassingOutput()),
    );

    expect(grade).toMatchObject({
      failures: [],
      metrics: {
        actualFindings: 1,
        expectedFindings: 1,
        matchedFindings: 1,
        precision: 1,
        recall: 1,
        severityMatches: 1,
        unexpectedFindings: 0,
      },
      passed: true,
    });
  });

  it("treats an explicit single-line start as the same location", () => {
    const output = evalSubjectOutputSchema.parse(createPassingOutput());
    const finding = output.output.findings[0];
    if (finding === undefined)
      throw new TypeError("fixture finding is required");

    const grade = gradeEvaluationCase(createEvalCase(), {
      ...output,
      output: {
        ...output.output,
        findings: [
          {
            ...finding,
            location: { ...finding.location, startLine: finding.location.line },
          },
        ],
      },
    });

    expect(grade.passed).toBe(true);
  });

  it("separates a severity error from finding detection", () => {
    const output = evalSubjectOutputSchema.parse(createPassingOutput());
    const finding = output.output.findings[0];
    if (finding === undefined)
      throw new TypeError("fixture finding is required");
    const grade = gradeEvaluationCase(createEvalCase(), {
      ...output,
      output: {
        ...output.output,
        findings: [
          {
            ...finding,
            severity: "medium",
          },
        ],
      },
    });

    expect(grade.failures).toEqual([
      {
        actual: "medium",
        expected: "high",
        findingId: "return-null",
        kind: "severity_mismatch",
      },
    ]);
    expect(grade.metrics).toMatchObject({
      precision: 1,
      recall: 1,
      severityMatches: 0,
    });
  });

  it("reports confidence and actionability independently", () => {
    const output = evalSubjectOutputSchema.parse(createPassingOutput());
    const finding = output.output.findings[0];
    if (finding === undefined)
      throw new TypeError("fixture finding is required");
    const { suggestion, ...findingWithoutSuggestion } = finding;
    expect(suggestion).toBeDefined();
    const grade = gradeEvaluationCase(createEvalCase(), {
      ...output,
      output: {
        ...output.output,
        findings: [{ ...findingWithoutSuggestion, confidence: 0.7 }],
      },
    });

    expect(grade.failures).toEqual([
      {
        actual: 0.7,
        findingId: "return-null",
        kind: "confidence_below_minimum",
        minimum: 0.8,
      },
      { findingId: "return-null", kind: "missing_suggestion" },
    ]);
    expect(grade.metrics).toMatchObject({ precision: 1, recall: 1 });
  });

  it("finds a maximum one-to-one match for overlapping expectations", () => {
    const baseCase = createEvalCase();
    const expectedFinding = baseCase.expected.findings[0];
    if (expectedFinding === undefined) {
      throw new TypeError("fixture expectation is required");
    }
    const evalCase = createEvalCase({
      expected: {
        ...baseCase.expected,
        findings: [
          {
            ...expectedFinding,
            id: "general-return",
            requiredDiagnosticTerms: [],
          },
          {
            ...expectedFinding,
            id: "specific-return",
            requiredDiagnosticTerms: ["returns null"],
          },
        ],
      },
    });
    const output = evalSubjectOutputSchema.parse(createPassingOutput());
    const firstFinding = output.output.findings[0];
    if (firstFinding === undefined) {
      throw new TypeError("fixture finding is required");
    }
    const grade = gradeEvaluationCase(evalCase, {
      ...output,
      output: {
        ...output.output,
        findings: [
          firstFinding,
          {
            ...firstFinding,
            diagnostic:
              "The changed branch violates the established caller contract and must be restored.",
          },
        ],
      },
    });

    expect(grade.passed).toBe(true);
    expect(grade.metrics.matchedFindings).toBe(2);
  });

  it("grades an empty negative case as perfect precision and recall", () => {
    const evalCase = createEvalCase({
      category: "no-finding",
      expected: {
        findings: [],
        forbiddenOutputTerms: [],
        partial: false,
        requiredSummaryTerms: [],
      },
      id: "negative.clean-change",
    });
    const grade = gradeEvaluationCase(evalCase, {
      output: { findings: [], summary: "No actionable findings." },
      partial: false,
    });

    expect(grade.metrics.precision).toBe(1);
    expect(grade.metrics.recall).toBe(1);
    expect(grade.passed).toBe(true);
  });

  it("reports partial, summary, and forbidden-language failures", () => {
    const output = evalSubjectOutputSchema.parse(createPassingOutput());
    const grade = gradeEvaluationCase(createEvalCase(), {
      ...output,
      output: {
        ...output.output,
        summary: "placeholder",
      },
      partial: true,
    });

    expect(grade.failures).toEqual([
      { actual: true, expected: false, kind: "partial_mismatch" },
      { kind: "missing_summary_term", term: "one finding" },
      { kind: "forbidden_output_term", term: "placeholder" },
    ]);
  });
});
