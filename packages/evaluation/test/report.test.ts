import { describe, expect, it } from "vitest";

import {
  createEvaluationReport,
  renderEvaluationSummary,
  runEvaluationSuite,
} from "../src/index.js";
import {
  createEvalCase,
  createPassingOutput,
  evaluationConfiguration,
} from "./fixtures.js";

describe("evaluation report", () => {
  it("renders stable metadata and failure kinds without model content", async () => {
    const suite = await runEvaluationSuite(
      [createEvalCase()],
      async () => createPassingOutput(),
      evaluationConfiguration,
    );
    const report = createEvaluationReport(suite, "a".repeat(40));

    expect(renderEvaluationSummary(report)).toContain(
      "| `correctness.return-null` | completed | none |",
    );
    expect(JSON.stringify(report)).not.toContain("installation-token");
  });

  it("rejects an unsafe source revision", () => {
    expect(() =>
      createEvaluationReport({} as never, "revision with spaces"),
    ).toThrow(/source revision is invalid/u);
  });

  it("renders a safe subject failure instead of provider content", async () => {
    const suite = await runEvaluationSuite(
      [createEvalCase()],
      async () => {
        throw new Error("private provider payload");
      },
      evaluationConfiguration,
    );
    const summary = renderEvaluationSummary(
      createEvaluationReport(suite, "a".repeat(40)),
    );

    expect(summary).toContain("| subject_error | unknown |");
    expect(summary).not.toContain("private provider payload");
    expect(summary).toContain("Precision: n/a");
  });
});
