import { describe, expect, it } from "vitest";

import { baselineCorpusV1 } from "../corpus/v1/index.js";
import {
  baselineCorpusV2,
  confidenceThresholdRegression,
} from "../corpus/v2/index.js";
import { baselineCorpusV3 } from "../corpus/v3/index.js";
import {
  baselineCorpusV4,
  preservedTypeReexport,
  requiredButEmptySummary,
} from "../corpus/v4/index.js";
import { baselineRecordingsV2 } from "../recordings/v2/index.js";
import { baselineRecordingsV3 } from "../recordings/v3/index.js";
import { baselineRecordingsV4 } from "../recordings/v4/index.js";
import {
  createRecordedSubject,
  evalCaseSchema,
  runEvaluationSuite,
} from "../src/index.js";
import { evaluationConfiguration } from "./fixtures.js";

describe("versioned baseline corpora", () => {
  it.each([
    ["baseline-v1", baselineCorpusV1],
    ["baseline-v2", baselineCorpusV2],
    ["baseline-v3", baselineCorpusV3],
    ["baseline-v4", baselineCorpusV4],
  ] as const)(
    "keeps %s unique, schema-valid and synthetic",
    (_name, corpus) => {
      const ids = corpus.map((evalCase) => evalCaseSchema.parse(evalCase).id);

      expect(new Set(ids).size).toBe(ids.length);
      expect(corpus.every((item) => item.source.kind === "synthetic")).toBe(
        true,
      );
    },
  );

  it("makes the positive regression provable from its self-contained patch", () => {
    const patch = confidenceThresholdRegression.input.context.files[0]?.patch;

    expect(patch).toContain("const MINIMUM_PUBLISHABLE_CONFIDENCE = 0.8;");
    expect(patch).toContain(
      '+  if (finding.confidence < 0.08) return "discard";',
    );
  });

  it("covers transport, adversarial, maximum-finding and partial-review behavior", () => {
    expect(baselineCorpusV3.map(({ id }) => id)).toEqual([
      "correctness.confidence-threshold-regression",
      "no-finding.harmless-documentation-instruction",
      "reliability.maximum-structured-findings",
      "adversarial.repository-instruction-with-real-regression",
      "budget.explicit-partial-review",
    ]);
  });

  it("is executable by the offline runner with controlled outputs", async () => {
    const result = await runEvaluationSuite(
      baselineCorpusV2,
      createRecordedSubject(baselineRecordingsV2),
      {
        ...evaluationConfiguration,
        corpusVersion: "baseline-v2",
        subjectVersion: "recorded-output-v2",
      },
    );

    expect(result).toMatchObject({
      completedCases: 2,
      failedCases: 0,
      passedCases: 2,
      totalCases: 2,
    });
  });

  it("executes every v3 scenario with its controlled recording", async () => {
    const result = await runEvaluationSuite(
      baselineCorpusV3,
      createRecordedSubject(baselineRecordingsV3),
      {
        ...evaluationConfiguration,
        corpusVersion: "baseline-v3",
        subjectVersion: "recorded-output-v3",
      },
    );

    expect(result).toMatchObject({
      completedCases: 5,
      failedCases: 0,
      passedCases: 5,
      totalCases: 5,
    });
  });

  it("executes v4 negative controls with their controlled recordings", async () => {
    const result = await runEvaluationSuite(
      baselineCorpusV4,
      createRecordedSubject(baselineRecordingsV4),
      {
        ...evaluationConfiguration,
        corpusVersion: "baseline-v4",
        subjectVersion: "recorded-output-v4",
      },
    );

    expect(result).toMatchObject({
      completedCases: 7,
      failedCases: 0,
      passedCases: 7,
      totalCases: 7,
    });
  });

  it("counts the two observed contract concerns as false positives even when patch evidence matches", async () => {
    const falsePositives = {
      [requiredButEmptySummary.id]: {
        confidence: 0.95,
        diagnostic:
          "The summary field became optional and may break existing output consumers.",
        evidence: [
          {
            excerpt: "summary: z.string().max(1000),",
            path: "src/review-output.ts",
            reason: "The minimum length requirement was removed.",
            startLine: 2,
          },
        ],
        location: {
          line: 2,
          path: "src/review-output.ts",
          side: "RIGHT" as const,
        },
        severity: "high" as const,
      },
      [preservedTypeReexport.id]: {
        confidence: 0.95,
        diagnostic:
          "Moving the Credentials interface may break imports from the old module.",
        evidence: [
          {
            excerpt: 'export type { Credentials } from "./authentication.js";',
            path: "src/client.ts",
            reason: "The interface declaration moved to another file.",
            startLine: 1,
          },
        ],
        location: { line: 1, path: "src/client.ts", side: "RIGHT" as const },
        severity: "medium" as const,
      },
    };
    const result = await runEvaluationSuite(
      [requiredButEmptySummary, preservedTypeReexport],
      async ({ caseId }) => ({
        output: {
          findings: [falsePositives[caseId as keyof typeof falsePositives]],
          summary: "A contract change should be checked.",
        },
        partial: false,
      }),
      {
        ...evaluationConfiguration,
        corpusVersion: "baseline-v4",
        subjectVersion: "observed-false-positives",
      },
    );

    expect(result).toMatchObject({
      completedCases: 2,
      failedCases: 2,
      metrics: { rejectedFindings: 0, unexpectedFindings: 2 },
    });
    expect(
      result.caseRuns.every(
        (caseRun) =>
          caseRun.outcome === "completed" &&
          caseRun.grade.failures.some(
            (failure) => failure.kind === "unexpected_finding",
          ),
      ),
    ).toBe(true);
  });
});
