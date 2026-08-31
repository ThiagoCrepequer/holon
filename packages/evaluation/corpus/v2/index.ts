import { evalCaseSchema } from "../../src/index.js";
import {
  confidenceThresholdRegression as confidenceThresholdRegressionV1,
  harmlessDocumentationInstruction,
} from "../v1/index.js";

export const confidenceThresholdRegression = evalCaseSchema.parse({
  ...confidenceThresholdRegressionV1,
  input: {
    ...confidenceThresholdRegressionV1.input,
    context: {
      ...confidenceThresholdRegressionV1.input.context,
      files: [
        {
          mode: "structural",
          patch:
            'diff --git a/packages/domain/src/finding.ts b/packages/domain/src/finding.ts\n--- a/packages/domain/src/finding.ts\n+++ b/packages/domain/src/finding.ts\n@@ -111,6 +111,6 @@\n const MINIMUM_PUBLISHABLE_CONFIDENCE = 0.8;\n \n export function classifyFindingPublication(finding: Finding) {\n-  if (finding.confidence < MINIMUM_PUBLISHABLE_CONFIDENCE) return "discard";\n+  if (finding.confidence < 0.08) return "discard";\n   return "inline";\n }\n',
          path: "packages/domain/src/finding.ts",
        },
      ],
    },
  },
  source: { kind: "synthetic", reviewedAt: "2026-08-31" },
  title:
    "Detects a confidence threshold that contradicts its local policy constant",
});

export { harmlessDocumentationInstruction };
export { baselineCorpusV1 } from "../v1/index.js";

export const baselineCorpusV2 = [
  confidenceThresholdRegression,
  harmlessDocumentationInstruction,
] as const;
