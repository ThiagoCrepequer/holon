import { describe, expect, it } from "vitest";

import { baselineCorpusV1 } from "../corpus/v1/index.js";
import { baselineRecordingsV1 } from "../recordings/v1/index.js";
import {
  createRecordedSubject,
  evalCaseSchema,
  runEvaluationSuite,
} from "../src/index.js";
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
      createRecordedSubject(baselineRecordingsV1),
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
