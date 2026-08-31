import { describe, expect, it, vi } from "vitest";

import { evalSubjectOutputSchema, runEvaluationSuite } from "../src/index.js";
import {
  createEvalCase,
  createPassingOutput,
  evaluationConfiguration,
} from "./fixtures.js";

describe("runEvaluationSuite", () => {
  it("rejects an empty suite instead of producing a false green result", async () => {
    const subject = vi.fn().mockResolvedValue(createPassingOutput());

    await expect(
      runEvaluationSuite([], subject, evaluationConfiguration),
    ).rejects.toThrow(/must contain at least one case/u);
    expect(subject).not.toHaveBeenCalled();
  });

  it("runs validated cases in stable input order", async () => {
    const first = createEvalCase();
    const second = createEvalCase({
      id: "correctness.second-case",
      title: "Second deterministic case",
    });
    const subject = vi.fn().mockResolvedValue(createPassingOutput());

    const result = await runEvaluationSuite(
      [first, second],
      subject,
      evaluationConfiguration,
    );

    expect(result).toMatchObject({
      completedCases: 2,
      configuration: evaluationConfiguration,
      failedCases: 0,
      failedGrades: 0,
      invalidOutputs: 0,
      metrics: {
        actualFindings: 2,
        expectedFindings: 2,
        matchedFindings: 2,
        precision: 1,
        recall: 1,
        rejectedFindings: 0,
        severityMatches: 2,
        unexpectedFindings: 0,
      },
      passedCases: 2,
      subjectErrors: 0,
      schemaVersion: 1,
      totalCases: 2,
    });
    expect(result.caseRuns.map((run) => run.caseId)).toEqual([
      first.id,
      second.id,
    ]);
    expect(subject).toHaveBeenNthCalledWith(1, first.input);
    expect(subject).toHaveBeenNthCalledWith(2, second.input);
  });

  it("classifies invalid output without leaking validation details", async () => {
    const result = await runEvaluationSuite(
      [createEvalCase()],
      async () => ({ output: { findings: [] } }),
      evaluationConfiguration,
    );

    expect(result).toMatchObject({
      completedCases: 0,
      failedCases: 1,
      invalidOutputs: 1,
      metrics: { precision: null, recall: null },
      subjectErrors: 0,
    });
    expect(result.caseRuns).toEqual([
      { caseId: "correctness.return-null", outcome: "invalid_output" },
    ]);
  });

  it("rejects a schema-valid finding whose evidence is absent from the patch", async () => {
    const output = evalSubjectOutputSchema.parse(createPassingOutput());
    const finding = output.output.findings[0];
    const evidence = finding?.evidence[0];
    if (evidence === undefined)
      throw new TypeError("fixture evidence is required");
    const candidate = {
      ...output,
      output: {
        ...output.output,
        findings: [
          {
            ...finding,
            evidence: [
              {
                ...evidence,
                excerpt: "content that does not exist in the patch",
              },
            ],
          },
        ],
      },
    };

    const result = await runEvaluationSuite(
      [createEvalCase()],
      async () => candidate,
      evaluationConfiguration,
    );

    expect(result).toMatchObject({
      failedCases: 1,
      metrics: {
        actualFindings: 0,
        recall: 0,
        rejectedFindings: 1,
      },
      passedCases: 0,
    });
    expect(result.caseRuns[0]).toMatchObject({
      grade: {
        failures: [{ findingId: "return-null", kind: "missing_finding" }],
      },
      outcome: "completed",
      rejectedFindings: 1,
    });
  });

  it("classifies subject errors without retaining arbitrary messages", async () => {
    const result = await runEvaluationSuite(
      [createEvalCase()],
      async () => {
        throw new Error("secret model response");
      },
      evaluationConfiguration,
    );

    expect(result).toMatchObject({
      completedCases: 0,
      failedCases: 1,
      invalidOutputs: 0,
      subjectErrors: 1,
    });
    expect(JSON.stringify(result)).not.toContain("secret model response");
  });

  it("rejects duplicate case identifiers before invoking the subject", async () => {
    const evalCase = createEvalCase();
    const subject = vi.fn().mockResolvedValue(createPassingOutput());

    await expect(
      runEvaluationSuite(
        [evalCase, evalCase],
        subject,
        evaluationConfiguration,
      ),
    ).rejects.toThrow(/case ids must be unique/u);
    expect(subject).not.toHaveBeenCalled();
  });
});
