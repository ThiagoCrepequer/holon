import { expect, it } from "vitest";

import { compareEvaluationSubjects } from "../src/index.js";
import {
  createEvalCase,
  createPassingOutput,
  evaluationConfiguration,
} from "./fixtures.js";
it("reports regressions and errors in the same paired cases without inventing a quality gain", async () => {
  const cases = [createEvalCase()];
  const results = await compareEvaluationSubjects(
    cases,
    [
      { name: "baseline", run: async () => createPassingOutput() },
      {
        name: "specialist",
        run: async () => {
          throw new Error("provider failure");
        },
      },
    ],
    evaluationConfiguration,
  );
  expect(results.comparisons).toEqual([
    { name: "specialist", regressions: [cases[0]!.id], improvements: [] },
  ]);
  expect(results.variants[1]!.suite.metrics.recall).toBe(0);
  await expect(
    compareEvaluationSubjects(
      cases,
      [{ name: "same", run: async () => null }],
      evaluationConfiguration,
    ),
  ).rejects.toThrow(/distinct/u);
});
