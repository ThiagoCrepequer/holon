import {
  createOpenAICompatible,
  type OpenAICompatibleProviderSettings,
} from "@ai-sdk/openai-compatible";
import { tool } from "@ai-sdk/provider-utils";
import {
  readFileArgumentsSchema,
  searchStructureArgumentsSchema,
  searchTextArgumentsSchema,
  type RepositoryToolCall,
} from "@holon/contracts";

export interface RepositoryToolExecution {
  readonly abortSignal?: AbortSignal | undefined;
  readonly deadlineAt?: number | undefined;
}

export interface RepositoryToolRunner {
  run(
    call: RepositoryToolCall,
    execution?: RepositoryToolExecution,
  ): Promise<{ readonly content: string; readonly truncated: boolean }>;
}

export interface CloudflareGatewayModelConfig {
  readonly accountId: string;
  readonly apiToken: string;
  readonly gatewayId: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly model: string;
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

export type NonRetryableModelFailureCode =
  | "model_budget_exhausted"
  | "object_invalid"
  | "output_missing"
  | "provider_permanent"
  | "schema_invalid";

const nonRetryableModelErrorCodes = new Map<
  string,
  NonRetryableModelFailureCode
>([
  ["ModelReviewBudgetExceededError", "model_budget_exhausted"],
  ["AI_NoObjectGeneratedError", "object_invalid"],
  ["AI_NoOutputGeneratedError", "output_missing"],
  ["ZodError", "schema_invalid"],
]);

export function nonRetryableModelFailureCode(
  error: unknown,
): NonRetryableModelFailureCode | undefined {
  if (isNonRetryableModelProviderError(error)) return "provider_permanent";
  return error instanceof Error
    ? nonRetryableModelErrorCodes.get(error.name)
    : undefined;
}

export function isNonRetryableModelError(error: unknown): boolean {
  return nonRetryableModelFailureCode(error) !== undefined;
}

export function parseGatewayModelReference(
  reference: string,
): GatewayModelReference {
  if (reference.length > 256 || !dynamicRoutePattern.test(reference))
    throw new TypeError(
      "AI_MODEL_ID must use the dynamic route format dynamic/{route}",
    );
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
  return createOpenAICompatible(createGatewayProviderSettings(config))(modelId);
}

export function createRepositoryModelTools(
  toolsRunner: RepositoryToolRunner,
  deadlineAt?: () => number,
) {
  return {
    read_file: tool({
      description:
        "Read at most 500 lines from a repository-relative source file.",
      execute: (arguments_, { abortSignal }) =>
        toolsRunner.run(
          { arguments: arguments_, name: "read_file" },
          { abortSignal, deadlineAt: deadlineAt?.() },
        ),
      inputSchema: readFileArgumentsSchema,
    }),
    search_structure: tool({
      description:
        "Search JavaScript or TypeScript syntax using an ast-grep pattern.",
      execute: (arguments_, { abortSignal }) =>
        toolsRunner.run(
          { arguments: arguments_, name: "search_structure" },
          { abortSignal, deadlineAt: deadlineAt?.() },
        ),
      inputSchema: searchStructureArgumentsSchema,
    }),
    search_text: tool({
      description: "Search exact text in the repository with bounded results.",
      execute: (arguments_, { abortSignal }) =>
        toolsRunner.run(
          { arguments: arguments_, name: "search_text" },
          { abortSignal, deadlineAt: deadlineAt?.() },
        ),
      inputSchema: searchTextArgumentsSchema,
    }),
  };
}
