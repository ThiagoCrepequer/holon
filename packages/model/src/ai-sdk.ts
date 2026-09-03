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
  readonly attempt: "investigation" | "finalization" | "recovery";
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

export const finalizationInstructions = [
  "You are Holon, finalizing a code review based on investigation results.",
  "Synthesize all concrete regressions found during investigation into the required structured output schema.",
  "Report only proven functional bugs, security vulnerabilities, or contract violations.",
  "Provide a concise executive summary ideally between 500 and 1,000 characters.",
  "If no regression was proven or evidence is insufficient, return an empty findings array with an informative summary.",
  "Every evidence excerpt must appear in the canonical patch at the stated line range.",
  "CRITICAL: Output MUST be raw, valid JSON only. Do NOT output markdown code blocks (```json), thinking tags, introductory text or explanations. Do NOT re-investigate.",
].join("\n");

export function extractCompactContext(prompt: string): string {
  const lines = prompt.split("\n");
  const metadataLines: string[] = [];
  for (const line of lines) {
    if (
      line.startsWith("diff --git") ||
      line.startsWith("--- a/") ||
      line.startsWith("+++ b/")
    ) {
      break;
    }
    metadataLines.push(line);
  }
  return metadataLines.join("\n").trim();
}

export function extractAndParseJsonReview(text: string): unknown {
  if (!text || typeof text !== "string") return undefined;

  // Strip <think> tags from reasoning models
  const withoutThinking = text.replace(/<think>[\s\S]*?<\/think>/gu, "").trim();

  // Match markdown codeblocks ```json ... ``` or ``` ... ```
  const codeBlockMatch = /```(?:json)?\s*([\s\S]*?)\s*```/u.exec(
    withoutThinking,
  );
  const matchedContent = codeBlockMatch?.[1];
  const candidate =
    matchedContent !== undefined ? matchedContent.trim() : withoutThinking;

  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return undefined;
  }

  const jsonSubstring = candidate.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(jsonSubstring);
  } catch {
    return undefined;
  }
}

export function extractCandidateFindingsFromText(
  text: string,
): readonly unknown[] {
  if (!text || typeof text !== "string") return [];
  const findings: unknown[] = [];
  const fileLinePattern =
    /(?:^|\s)([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+):(\d+)(?:\b|\s)/gu;
  let match: RegExpExecArray | null;
  const seen = new Set<string>();

  while ((match = fileLinePattern.exec(text)) !== null) {
    const path = match[1]!;
    const line = Number.parseInt(match[2]!, 10);
    const key = `${path}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const afterMatch = text.slice(
      match.index + match[0].length,
      match.index + match[0].length + 400,
    );
    const codeMatch =
      /`([^`\n]+)`|((?:return|const|let|var|def|func|export)\s+[^\n]+)/u.exec(
        afterMatch,
      );
    const rawExcerpt = codeMatch?.[1] ?? codeMatch?.[2] ?? codeMatch?.[0];
    const excerpt = rawExcerpt?.trim();

    if (excerpt && excerpt.length >= 3) {
      findings.push({
        confidence: 0.85,
        diagnostic: `Potential issue identified during investigation at ${path}:${line}`,
        evidence: [
          {
            endLine: null,
            excerpt: excerpt.slice(0, 290),
            path,
            reason: "Identified during investigative analysis",
            startLine: line,
          },
        ],
        location: {
          line,
          path,
          side: "RIGHT",
          startLine: null,
        },
        severity: "medium",
        suggestion: null,
      });
    }
    if (findings.length >= 3) break;
  }
  return findings;
}

export class TwoPhaseReviewGenerator implements ReviewGenerator {
  public constructor(
    private readonly config: CloudflareGatewayModelConfig,
    private readonly toolsRunner: RepositoryToolRunner,
    private readonly onUsage?: (usage: ModelUsage) => void,
    private readonly outputContract: ModelOutputContract = "portable",
  ) {}

  public async generate(request: ReviewGenerationRequest): Promise<unknown> {
    const model = createGatewayLanguageModel(this.config);
    const tools = createRepositoryModelTools(this.toolsRunner);

    // Phase 1: Investigative Tool Loop (freeform diagnostic text)
    let investigationText = "";
    try {
      const investigationResult = await generateText({
        instructions: request.instructions,
        maxOutputTokens: 4_000,
        maxRetries: 0,
        model,
        prompt: request.prompt,
        providerOptions: gatewayModelProviderOptions,
        stopWhen: stepCountIs(maximumInvestigationSteps),
        temperature: 0,
        tools,
      });

      this.onUsage?.({
        attempt: "investigation",
        finishReason: investigationResult.finishReason,
        inputTokens: investigationResult.usage?.inputTokens,
        outputTokens: investigationResult.usage?.outputTokens,
        toolCallCount: investigationResult.toolCalls?.length ?? 0,
        totalTokens: investigationResult.usage?.totalTokens,
      });

      investigationText = investigationResult.text ?? "";
    } catch (error) {
      if (APICallError.isInstance(error)) {
        throw new ModelProviderRequestError(
          error.isRetryable,
          error.statusCode,
        );
      }
      throw error;
    }

    // Phase 2: Dedicated Structured Finalization Step
    const compactContext = extractCompactContext(request.prompt);
    const finalizationPrompt = [
      "### Review Metadata & Allowed Line Ranges",
      compactContext.length > 0
        ? compactContext
        : request.prompt.slice(0, 2000),
      "",
      "### Investigation Findings and Analysis",
      investigationText.trim().length > 0
        ? investigationText
        : "No functional regressions were proven during investigation.",
      "",
      "Synthesize and return the final structured review JSON object directly.",
    ].join("\n");

    const runFinalization = async (
      attempt: "finalization" | "recovery",
    ): Promise<unknown> => {
      const isRecovery = attempt === "recovery";
      const instructions = isRecovery
        ? `${finalizationInstructions}\nThis is the single recovery attempt. Do not investigate further. Return the required final object directly.`
        : finalizationInstructions;

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

      const finalizationResult = await generateText({
        instructions,
        maxOutputTokens: 8_192,
        maxRetries: 0,
        model,
        output,
        prompt: finalizationPrompt,
        providerOptions: gatewayModelProviderOptions,
        stopWhen: stepCountIs(1),
        temperature: 0,
      });

      this.onUsage?.({
        attempt,
        finishReason: finalizationResult.finishReason,
        inputTokens: finalizationResult.usage?.inputTokens,
        outputTokens: finalizationResult.usage?.outputTokens,
        toolCallCount: finalizationResult.toolCalls?.length ?? 0,
        totalTokens: finalizationResult.usage?.totalTokens,
      });

      return this.outputContract === "portable"
        ? parseModelReviewTransport(finalizationResult.output)
        : modelReviewOutputSchema.parse(finalizationResult.output);
    };

    const rescueFromRawText = (error: unknown): unknown => {
      const rawText = (error as { text?: unknown })?.text;
      if (typeof rawText === "string" && rawText.trim().length > 0) {
        const extracted = extractAndParseJsonReview(rawText);
        if (
          extracted !== undefined &&
          typeof extracted === "object" &&
          extracted !== null
        ) {
          try {
            return this.outputContract === "portable"
              ? parseModelReviewTransport(extracted)
              : modelReviewOutputSchema.parse(extracted);
          } catch {
            // ignore schema error and continue to recovery or graceful degradation
          }
        }
      }
      return undefined;
    };

    try {
      return await runFinalization("finalization");
    } catch (error) {
      if (APICallError.isInstance(error)) {
        throw new ModelProviderRequestError(
          error.isRetryable,
          error.statusCode,
        );
      }

      const rescued = rescueFromRawText(error);
      if (rescued !== undefined) {
        return rescued;
      }

      if (
        !(error instanceof Error) ||
        !recoverableSemanticErrors.has(error.name)
      ) {
        throw error;
      }
    }

    try {
      return await runFinalization("recovery");
    } catch (error) {
      if (APICallError.isInstance(error)) {
        throw new ModelProviderRequestError(
          error.isRetryable,
          error.statusCode,
        );
      }

      const rescued = rescueFromRawText(error);
      if (rescued !== undefined) {
        return rescued;
      }

      // Graceful degradation only for semantic errors (AI_NoObjectGeneratedError, AI_NoOutputGeneratedError, ZodError)
      if (error instanceof Error && recoverableSemanticErrors.has(error.name)) {
        const rawFallbackText = (
          investigationText.trim().length > 0
            ? investigationText
            : ((error as { text?: string })?.text ?? "")
        )
          .replace(/<think>[\s\S]*?<\/think>/gu, "")
          .trim();

        if (rawFallbackText.length > 0) {
          const extractedCandidates =
            extractCandidateFindingsFromText(rawFallbackText);
          const maxSummaryLen = 2_500;
          let summary = rawFallbackText;
          if (summary.length > maxSummaryLen) {
            const slice = summary.slice(0, maxSummaryLen - 3);
            const lastBreak = Math.max(
              slice.lastIndexOf(". "),
              slice.lastIndexOf("\n"),
            );
            summary =
              lastBreak > 2_000
                ? `${slice.slice(0, lastBreak + 1)}...`
                : `${slice}...`;
          }

          const candidateOutput = {
            findings: extractedCandidates,
            isDegraded: true,
            summary,
          };

          try {
            return this.outputContract === "portable"
              ? parseModelReviewTransport(candidateOutput)
              : modelReviewOutputSchema.parse(candidateOutput);
          } catch {
            return {
              findings: [],
              isDegraded: true,
              summary,
            };
          }
        }
      }

      throw error;
    }
  }
}

export const AiSdkReviewGenerator = TwoPhaseReviewGenerator;
export type AiSdkReviewGenerator = TwoPhaseReviewGenerator;
