import { describe, expect, it } from "vitest";

import { baselineCorpusV1 } from "../corpus/v1/index.js";
import {
  baselineCorpusV2,
  confidenceThresholdRegression,
} from "../corpus/v2/index.js";
import { baselineRecordingsV2 } from "../recordings/v2/index.js";
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
});
