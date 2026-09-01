import { describe, expect, it } from "vitest";

import {
  createEvaluationReport,
  createHarnessComparisonReport,
  renderHarnessComparisonSummary,
  runEvaluationSuite,
} from "../src/index.js";
import {
  createEvalCase,
  createPassingOutput,
  evaluationConfiguration,
} from "./fixtures.js";

describe("harness comparison", () => {
  it("compares completion, quality, usage and latency without choosing a winner", async () => {
    const sourceRevision = "a".repeat(40);
    const create = async (subjectVersion: string, inputTokens: number) =>
      createEvaluationReport(
        await runEvaluationSuite(
          [createEvalCase()],
          async () => ({
            ...(createPassingOutput() as object),
            telemetry: {
              attempts: [
                {
                  attempt: "terminal-tool",
                  inputTokens,
                  outputTokens: 20,
                  toolCallCount: 1,
                  totalTokens: inputTokens + 20,
                },
              ],
              durationMs: inputTokens,
            },
          }),
          { ...evaluationConfiguration, subjectVersion },
        ),
        sourceRevision,
      );
    const report = createHarnessComparisonReport(
      [await create("subject-a", 100), await create("subject-b", 80)],
      sourceRevision,
    );

    expect(report.aggregates).toEqual([
      expect.objectContaining({
        durationMs: 100,
        inputTokens: 100,
        passedCases: 1,
        subject: "subject-a",
        toolCalls: 1,
        trials: 1,
      }),
      expect.objectContaining({
        durationMs: 80,
        inputTokens: 80,
        passedCases: 1,
        subject: "subject-b",
        toolCalls: 1,
        trials: 1,
      }),
    ]);
    const summary = renderHarnessComparisonSummary(report);
    expect(summary).toContain("does not select a winner automatically");
    expect(summary).toContain("| `subject-b` | 1 | 1/1 | 1/1 |");
  });

  it("rejects duplicate subjects and mixed revisions", async () => {
    const suite = await runEvaluationSuite(
      [createEvalCase()],
      async () => createPassingOutput(),
      evaluationConfiguration,
    );
    const first = createEvaluationReport(suite, "a".repeat(40));

    expect(() =>
      createHarnessComparisonReport([first, first], "a".repeat(40)),
    ).toThrow(/at least two subjects/u);
    expect(() =>
      createHarnessComparisonReport(
        [
          first,
          createEvaluationReport(
            {
              ...suite,
              configuration: {
                ...suite.configuration,
                subjectVersion: "other-subject",
              },
            },
            "b".repeat(40),
          ),
        ],
        "a".repeat(40),
      ),
    ).toThrow(/revisions must match/u);
  });
});
