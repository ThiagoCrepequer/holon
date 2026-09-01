/// <reference lib="webworker" />

import { tool } from "@ai-sdk/provider-utils";
import {
  modelReviewTransportSchema,
  parseModelReviewTransport,
} from "@holon/contracts";
import { APICallError, ToolLoopAgent, hasToolCall, stepCountIs } from "ai";

import {
  createGatewayLanguageModel,
  createRepositoryModelTools,
  gatewayModelProviderOptions,
  ModelProviderRequestError,
  type CloudflareGatewayModelConfig,
  type ModelUsage,
} from "./ai-sdk.js";
import type {
  RepositoryToolRunner,
  ReviewGenerationRequest,
  ReviewGenerator,
} from "./reviewer.js";

const maximumInvestigationSteps = 6;
const maximumModelSteps = maximumInvestigationSteps + 1;
const terminalToolName = "submit_review";

function missingTerminalOutput(): Error {
  const error = new Error("model did not call the terminal review tool");
  error.name = "AI_NoOutputGeneratedError";
  return error;
}

/**
 * Experimental harness that transports the final review as the arguments of a
 * terminal tool. AI SDK stops the loop as soon as the model submits a
 * schema-valid review; the execute function only acknowledges that submission.
 */
export class TerminalToolReviewGenerator implements ReviewGenerator {
  public constructor(
    private readonly config: CloudflareGatewayModelConfig,
    private readonly toolsRunner: RepositoryToolRunner,
    private readonly onUsage?: (usage: ModelUsage) => void,
  ) {}

  public async generate(request: ReviewGenerationRequest): Promise<unknown> {
    const repositoryTools = createRepositoryModelTools(this.toolsRunner);
    const submitReview = tool({
      description:
        "Submit the final pull request review. Call this as soon as the investigation is sufficient; it terminates the review.",
      execute: () => Promise.resolve({ accepted: true }),
      inputSchema: modelReviewTransportSchema,
    });
    const tools = { ...repositoryTools, submit_review: submitReview };
    const agent = new ToolLoopAgent<never, typeof tools>({
      instructions: request.instructions,
      maxOutputTokens: 4_000,
      maxRetries: 0,
      model: createGatewayLanguageModel(this.config),
      prepareStep: ({ stepNumber }) =>
        stepNumber >= maximumInvestigationSteps
          ? {
              activeTools: ["submit_review"],
              toolChoice: { toolName: terminalToolName, type: "tool" as const },
            }
          : undefined,
      providerOptions: gatewayModelProviderOptions,
      stopWhen: [hasToolCall(terminalToolName), stepCountIs(maximumModelSteps)],
      temperature: 0,
      toolChoice: "required",
      tools,
    });
    const result = await agent
      .generate({ prompt: request.prompt })
      .catch((error: unknown) => {
        if (APICallError.isInstance(error)) {
          throw new ModelProviderRequestError(
            error.isRetryable,
            error.statusCode,
          );
        }
        throw error;
      });
    this.onUsage?.({
      attempt: "terminal-tool",
      finishReason: result.finishReason,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      toolCallCount: result.toolCalls.length,
      totalTokens: result.usage.totalTokens,
    });
    const terminalCall = result.staticToolCalls.findLast(
      (call) => call.toolName === terminalToolName,
    );
    if (terminalCall === undefined) throw missingTerminalOutput();
    return parseModelReviewTransport(terminalCall.input);
  }
}
