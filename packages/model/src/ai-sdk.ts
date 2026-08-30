/// <reference lib="webworker" />

import {
  createOpenAICompatible,
  type OpenAICompatibleProviderSettings,
} from "@ai-sdk/openai-compatible";
import { tool } from "@ai-sdk/provider-utils";
import {
  modelReviewOutputSchema,
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
  readonly model: string;
}

export interface ModelUsage {
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
  readonly totalTokens: number | undefined;
}

export interface GatewayModelReference {
  readonly gatewayPath: "compat";
  readonly modelId: string;
}

const dynamicRoutePattern = /^dynamic\/[A-Za-z0-9][A-Za-z0-9._-]*$/u;

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
    },
    name: "cloudflare-ai-gateway",
  };
}

export class AiSdkReviewGenerator implements ReviewGenerator {
  public constructor(
    private readonly config: CloudflareGatewayModelConfig,
    private readonly toolsRunner: RepositoryToolRunner,
    private readonly onUsage?: (usage: ModelUsage) => void,
  ) {}

  public async generate(request: ReviewGenerationRequest): Promise<unknown> {
    const { modelId } = parseGatewayModelReference(this.config.model);
    const provider = createOpenAICompatible(
      createGatewayProviderSettings(this.config),
    );
    const tools = {
      read_file: tool({
        description:
          "Read at most 500 lines from a repository-relative source file.",
        execute: (arguments_) =>
          this.toolsRunner.run({ arguments: arguments_, name: "read_file" }),
        inputSchema: readFileArgumentsSchema,
      }),
      search_structure: tool({
        description:
          "Search JavaScript or TypeScript syntax using an ast-grep pattern.",
        execute: (arguments_) =>
          this.toolsRunner.run({
            arguments: arguments_,
            name: "search_structure",
          }),
        inputSchema: searchStructureArgumentsSchema,
      }),
      search_text: tool({
        description:
          "Search exact text in the repository with bounded results.",
        execute: (arguments_) =>
          this.toolsRunner.run({ arguments: arguments_, name: "search_text" }),
        inputSchema: searchTextArgumentsSchema,
      }),
    };
    let result;
    try {
      result = await generateText({
        instructions: request.instructions,
        maxOutputTokens: 4_000,
        maxRetries: 0,
        model: provider(modelId),
        output: Output.object({
          name: "holon_review",
          schema: modelReviewOutputSchema,
        }),
        prompt: request.prompt,
        stopWhen: stepCountIs(8),
        temperature: 0,
        tools,
      });
    } catch (error) {
      if (APICallError.isInstance(error)) {
        throw new ModelProviderRequestError(
          error.isRetryable,
          error.statusCode,
        );
      }
      throw error;
    }
    this.onUsage?.({
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
    });
    return result.output;
  }
}
