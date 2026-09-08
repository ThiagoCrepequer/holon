import {
  evalSubjectOutputSchema,
  type EvalSubjectOutput,
} from "../contracts.js";
import type { EvaluationSubject } from "../runner.js";

export interface EvaluationRecording {
  readonly caseId: string;
  readonly output: EvalSubjectOutput;
}

export function createRecordedSubject(
  recordings: readonly EvaluationRecording[],
): EvaluationSubject {
  const byCaseId = new Map<string, EvalSubjectOutput>();
  for (const recording of recordings) {
    if (byCaseId.has(recording.caseId)) {
      throw new TypeError("evaluation recording case ids must be unique");
    }
    byCaseId.set(
      recording.caseId,
      evalSubjectOutputSchema.parse(recording.output),
    );
  }
  return async ({ caseId }) => {
    const output = byCaseId.get(caseId);
    if (output === undefined) {
      throw new TypeError("evaluation recording is missing for case");
    }
    return output;
  };
}
