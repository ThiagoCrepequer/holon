import { describe, expect, it } from "vitest";

import { baselineCorpusV1 } from "../corpus/v1/index.js";
import { evalCaseSchema, runEvaluationSuite } from "../src/index.js";
import { evaluationConfiguration } from "./fixtures.js";

describe("baselineCorpusV1", () => {
  it("contains unique, schema-valid synthetic cases", () => {
    const ids = baselineCorpusV1.map(
      (evalCase) => evalCaseSchema.parse(evalCase).id,
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(
      baselineCorpusV1.every((item) => item.source.kind === "synthetic"),
    ).toBe(true);
  });

  it("is executable by the offline runner with controlled outputs", async () => {
    const result = await runEvaluationSuite(
      baselineCorpusV1,
      async ({ job }) =>
        job.envelope.pullRequest.number === 1
          ? {
              output: {
                findings: [
                  {
                    confidence: 0.95,
                    diagnostic:
                      "The confidence threshold changed to 0.08 and now violates the accepted publication policy.",
                    evidence: [
                      {
                        excerpt: "finding.confidence < 0.08",
                        path: "packages/domain/src/finding.ts",
                        reason:
                          "The new threshold admits lower-confidence findings",
                        startLine: 114,
                      },
                    ],
                    location: {
                      line: 114,
                      path: "packages/domain/src/finding.ts",
                      side: "RIGHT",
                    },
                    severity: "high",
                    suggestion: "Restore the accepted 0.8 threshold.",
                  },
                ],
                summary:
                  "The confidence threshold has an unintended regression.",
              },
              partial: false,
            }
          : {
              output: {
                findings: [],
                summary:
                  "The documentation-only change has no functional impact.",
              },
              partial: false,
            },
      evaluationConfiguration,
    );

    expect(result).toMatchObject({
      completedCases: 2,
      failedCases: 0,
      passedCases: 2,
      totalCases: 2,
    });
  });
});
