import {
  evalSubjectOutputSchema,
  type EvaluationRecording,
} from "../../src/index.js";
import { baselineRecordingsV3 } from "../v3/index.js";

export const baselineRecordingsV4 = [
  ...baselineRecordingsV3,
  {
    caseId: "no-finding.required-but-empty-summary",
    output: evalSubjectOutputSchema.parse({
      output: {
        findings: [],
        summary:
          "The summary remains required, and the transport normalizes empty text as degraded.",
      },
      partial: false,
    }),
  },
  {
    caseId: "no-finding.preserved-type-reexport",
    output: evalSubjectOutputSchema.parse({
      output: {
        findings: [],
        summary:
          "The type declaration moved while the original module re-exports it.",
      },
      partial: false,
    }),
  },
] as const satisfies readonly EvaluationRecording[];
