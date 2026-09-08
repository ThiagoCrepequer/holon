import { describe, expect, it } from "vitest";

import {
  createRecordedSubject,
  evalSubjectOutputSchema,
  type EvaluationRecording,
} from "../src/index.js";
import { createEvalCase, createPassingOutput } from "./fixtures.js";

const evalCase = createEvalCase();
const recording = {
  caseId: evalCase.id,
  output: evalSubjectOutputSchema.parse(createPassingOutput()),
} as const satisfies EvaluationRecording;

describe("createRecordedSubject", () => {
  it("returns the schema-validated recording for a case", async () => {
    await expect(
      createRecordedSubject([recording])({
        caseId: evalCase.id,
        ...evalCase.input,
      }),
    ).resolves.toMatchObject({ partial: false });
  });

  it("rejects duplicate and missing recordings", async () => {
    expect(() => createRecordedSubject([recording, recording])).toThrow(
      /case ids must be unique/u,
    );
    await expect(
      createRecordedSubject([])({ caseId: evalCase.id, ...evalCase.input }),
    ).rejects.toThrow(/recording is missing/u);
  });
});
