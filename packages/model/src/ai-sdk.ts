/// <reference lib="webworker" />

import {
  createOpenAICompatible,
  type OpenAICompatibleProviderSettings,
} from "@ai-sdk/openai-compatible";
import { tool } from "@ai-sdk/provider-utils";
import {
  modelReviewTransportSchema,
  modelReviewOutputSchema,
  parseModelReviewTransport,
  readFileArgumentsSchema,
  searchStructureArgumentsSchema,
  searchTextArgumentsSchema,
} from "@holon/contracts";
import { APICallError, Output, generateText, stepCountIs } from "ai";

import type {
  RepositoryToolRunner,
  ReviewGenerationRequest,
  ReviewGenerator,
} from "./reviewer.js";

export interface CloudflareGatewayModelConfig {
  readonly accountId: string;
  readonly apiToken: string;
  readonly gatewayId: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly model: string;
}

export interface ModelUsage {
  readonly attempt: "investigation" | "recovery" | "terminal-tool";
  readonly finishReason: string | undefined;
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
  readonly toolCallCount: number;
  readonly totalTokens: number | undefined;
}

export interface GatewayModelReference {
  readonly gatewayPath: "compat";
  readonly modelId: string;
}

export type ModelOutputContract = "domain" | "portable";

const dynamicRoutePattern = /^dynamic\/[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const maximumInvestigationSteps = 6;
const maximumModelSteps = maximumInvestigationSteps + 1;
const recoverableSemanticErrors = new Set([
  "AI_NoObjectGeneratedError",
  "AI_NoOutputGeneratedError",
  "ZodError",
]);

export class ModelProviderRequestError extends Error {
  public constructor(
    public readonly isRetryable: boolean,
    public readonly statusCode: number | undefined,
  ) {
    super(
      `HOLON_MODEL_${isRetryable ? "TRANSIENT" : "PERMANENT"}:${statusCode ?? "network"}`,
    );
    this.name = isRetryable ? "ModelTransientError" : "ModelPermanentError";
  }
}

export function isNonRetryableModelProviderError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "ModelPermanentError" ||
      error.message.startsWith("HOLON_MODEL_PERMANENT:"))
  );
}

export type NonRetryableModelFailureCode =
  | "object_invalid"
  | "output_missing"
  | "provider_permanent"
  | "schema_invalid"
  | "tool_budget_exhausted";

const nonRetryableModelErrorCodes = new Map<
  string,
  NonRetryableModelFailureCode
>([
  ["AI_NoObjectGeneratedError", "object_invalid"],
  ["AI_NoOutputGeneratedError", "output_missing"],
  ["RepositoryToolBudgetExceededError", "tool_budget_exhausted"],
  ["ZodError", "schema_invalid"],
]);

export function nonRetryableModelFailureCode(
  error: unknown,
): NonRetryableModelFailureCode | undefined {
  if (isNonRetryableModelProviderError(error)) return "provider_permanent";
  if (!(error instanceof Error)) return undefined;
  return nonRetryableModelErrorCodes.get(error.name);
}

export function isNonRetryableModelError(error: unknown): boolean {
  return nonRetryableModelFailureCode(error) !== undefined;
}

export function parseGatewayModelReference(
  reference: string,
): GatewayModelReference {
  if (reference.length > 256 || !dynamicRoutePattern.test(reference)) {
    throw new TypeError(
      "AI_MODEL_ID must use the dynamic route format dynamic/{route}",
    );
  }
  return { gatewayPath: "compat", modelId: reference };
}

export function createGatewayProviderSettings(
  config: CloudflareGatewayModelConfig,
): OpenAICompatibleProviderSettings {
  const { gatewayPath } = parseGatewayModelReference(config.model);
  return {
    baseURL: `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(config.accountId)}/${encodeURIComponent(config.gatewayId)}/${gatewayPath}`,
    headers: {
      "cf-aig-authorization": `Bearer ${config.apiToken}`,
      "cf-aig-collect-log-payload": "false",
      ...(config.metadata === undefined
        ? {}
        : { "cf-aig-metadata": JSON.stringify(config.metadata) }),
      "cf-aig-skip-cache": "true",
    },
    name: "cloudflare-ai-gateway",
    supportsStructuredOutputs: true,
  };
}

export function createGatewayLanguageModel(
  config: CloudflareGatewayModelConfig,
) {
  const { modelId } = parseGatewayModelReference(config.model);
  const provider = createOpenAICompatible(
    createGatewayProviderSettings(config),
  );
  return provider(modelId);
}

export function createRepositoryModelTools(toolsRunner: RepositoryToolRunner) {
  return {
    read_file: tool({
      description:
        "Read at most 500 lines from a repository-relative source file.",
      execute: (arguments_) =>
        toolsRunner.run({ arguments: arguments_, name: "read_file" }),
      inputSchema: readFileArgumentsSchema,
    }),
    search_structure: tool({
      description:
        "Search JavaScript or TypeScript syntax using an ast-grep pattern.",
      execute: (arguments_) =>
        toolsRunner.run({ arguments: arguments_, name: "search_structure" }),
      inputSchema: searchStructureArgumentsSchema,
    }),
    search_text: tool({
      description: "Search exact text in the repository with bounded results.",
      execute: (arguments_) =>
        toolsRunner.run({ arguments: arguments_, name: "search_text" }),
      inputSchema: searchTextArgumentsSchema,
    }),
  };
}

export const gatewayModelProviderOptions = {
  cloudflareAiGateway: {
    provider: {
      data_collection: "deny",
      require_parameters: true,
    },
    reasoningEffort: "low",
  },
} as const;

export class AiSdkReviewGenerator implements ReviewGenerator {
  public constructor(
    private readonly config: CloudflareGatewayModelConfig,
    private readonly toolsRunner: RepositoryToolRunner,
    private readonly onUsage?: (usage: ModelUsage) => void,
    private readonly outputContract: ModelOutputContract = "domain",
  ) {}

  public async generate(request: ReviewGenerationRequest): Promise<unknown> {
    const model = createGatewayLanguageModel(this.config);
    const tools = createRepositoryModelTools(this.toolsRunner);
    const runAttempt = async (
      attempt: "investigation" | "recovery",
    ): Promise<unknown> => {
      const investigation = attempt === "investigation";
      const output =
        this.outputContract === "portable"
          ? Output.object({
              name: "holon_review",
              schema: modelReviewTransportSchema,
            })
          : Output.object({
              name: "holon_review",
              schema: modelReviewOutputSchema,
            });
      const result = await generateText({
        instructions: investigation
          ? request.instructions
          : `${request.instructions}\nThis is the single recovery attempt. Do not investigate further. Return the required final object directly.`,
        maxOutputTokens: 4_000,
        maxRetries: 0,
        model,
        output,
        ...(investigation
          ? {
              prepareStep: ({ stepNumber }: { stepNumber: number }) =>
                stepNumber >= maximumInvestigationSteps
                  ? { activeTools: [], toolChoice: "none" as const }
                  : undefined,
              stopWhen: stepCountIs(maximumModelSteps),
              tools,
            }
          : { stopWhen: stepCountIs(1) }),
        prompt: request.prompt,
        providerOptions: gatewayModelProviderOptions,
        temperature: 0,
      });
      this.onUsage?.({
        attempt,
        finishReason: result.finishReason,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        toolCallCount: result.toolCalls?.length ?? 0,
        totalTokens: result.usage.totalTokens,
      });
      return this.outputContract === "portable"
        ? parseModelReviewTransport(result.output)
        : modelReviewOutputSchema.parse(result.output);
    };

    try {
      return await runAttempt("investigation");
    } catch (error) {
      if (APICallError.isInstance(error)) {
        throw new ModelProviderRequestError(
          error.isRetryable,
          error.statusCode,
        );
      }
      if (
        !(error instanceof Error) ||
        !recoverableSemanticErrors.has(error.name)
      ) {
        throw error;
      }
    }

    try {
      return await runAttempt("recovery");
    } catch (error) {
      if (APICallError.isInstance(error)) {
        throw new ModelProviderRequestError(
          error.isRetryable,
          error.statusCode,
        );
      }
      throw error;
    }
  }
}
