import {
  ThinkPromptAbortedError,
  ThinkPromptError,
  ThinkPromptSkippedError,
  ThinkPromptTimeoutError,
  ThinkPromptValidationError,
  ThinkWorkflow,
  type ThinkWorkflowStep,
} from "@cloudflare/think/workflows";
import {
  modelReviewTransportSchema,
  parseModelReviewTransport,
} from "@holon/contracts";
import {
  evalSubjectOutputSchema,
  evaluationSubjectFailureReasonSchema,
} from "@holon/evaluation";
import { baselineCorpusV3 } from "@holon/evaluation/corpus/v3";
import { buildReviewPromptResult } from "@holon/model";
import type { AgentWorkflowEvent } from "agents/workflows";
import { z } from "zod";

import type { HarnessEvaluationAgent } from "./agent.js";

export interface HarnessWorkflowParams {
  readonly caseId: string;
}

const casesById = new Map(
  baselineCorpusV3.map((evaluationCase) => [evaluationCase.id, evaluationCase]),
);

export const harnessWorkflowResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("complete"),
    result: evalSubjectOutputSchema.omit({ telemetry: true }),
  }),
  z.strictObject({
    kind: z.literal("error"),
    // Workflow failures cross a durable serialization boundary. Preserve only
    // the stable failure class, never provider text or model output.
    reason: evaluationSubjectFailureReasonSchema,
  }),
]);

export type HarnessWorkflowResult = z.infer<typeof harnessWorkflowResultSchema>;

function workflowFailure(error: unknown): HarnessWorkflowResult {
  if (error instanceof ThinkPromptValidationError) {
    return { kind: "error", reason: "model_output_invalid" };
  }
  if (error instanceof ThinkPromptAbortedError) {
    return { kind: "error", reason: "execution_aborted" };
  }
  if (error instanceof ThinkPromptSkippedError) {
    return { kind: "error", reason: "execution_skipped" };
  }
  if (error instanceof ThinkPromptTimeoutError) {
    return { kind: "error", reason: "execution_timeout" };
  }
  if (error instanceof ThinkPromptError) {
    return { kind: "error", reason: "execution_error" };
  }
  return { kind: "error", reason: "unknown" };
}

export class HarnessEvaluationWorkflow extends ThinkWorkflow<
  HarnessEvaluationAgent,
  HarnessWorkflowParams,
  unknown,
  Cloudflare.Env
> {
  public override async run(
    event: AgentWorkflowEvent<HarnessWorkflowParams>,
    step: ThinkWorkflowStep,
  ): Promise<HarnessWorkflowResult> {
    return await runHarnessEvaluationWorkflow(event.payload.caseId, step);
  }
}

export async function runHarnessEvaluationWorkflow(
  caseId: string,
  step: Pick<ThinkWorkflowStep, "prompt">,
): Promise<HarnessWorkflowResult> {
  const evaluationCase = casesById.get(caseId);
  if (evaluationCase === undefined) {
    return { kind: "error", reason: "unknown" };
  }
  const prompt = buildReviewPromptResult(
    evaluationCase.input.job,
    evaluationCase.input.context,
  );
  try {
    const transported = await step.prompt("review", {
      output: modelReviewTransportSchema,
      prompt: prompt.prompt,
      timeout: "3 minutes",
    });
    return {
      kind: "complete",
      result: {
        output: parseModelReviewTransport(transported),
        partial: evaluationCase.input.context.truncated || prompt.truncated,
      },
    };
  } catch (error) {
    return workflowFailure(error);
  }
}
