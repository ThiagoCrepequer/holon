import type {
  ModelGenerationReservation,
  ModelGenerationAdmission,
} from "@holon/contracts";
import { wrapLanguageModel, type LanguageModel } from "ai";

export interface ModelGenerationBudget {
  readonly outputLimits?:
    | { readonly repository: number; readonly final: number }
    | undefined;
  reserve(
    request: Omit<ModelGenerationReservation, "shardIndex" | "shardCount">,
  ): Promise<ModelGenerationAdmission | undefined>;
  settle(id: number, outputTokens: number): Promise<void>;
}
export class ModelReviewBudgetExceededError extends Error {
  public constructor(
    public readonly admission: Extract<
      ModelGenerationAdmission,
      { accepted: false }
    >,
  ) {
    super(
      admission.reason.startsWith("shard_")
        ? "Shard review generation budget exhausted"
        : "Aggregate review generation budget exhausted",
    );
    this.name = "ModelReviewBudgetExceededError";
  }
}
export function withGenerationBudget(
  model: Exclude<LanguageModel, string>,
  budget?: ModelGenerationBudget,
  phase: ModelGenerationReservation["phase"] = "investigation",
) {
  if (!budget) return model;
  const reserve = async (params: {
    readonly abortSignal?: AbortSignal;
    readonly maxOutputTokens?: number;
    readonly prompt: unknown;
    readonly tools?: unknown;
    readonly responseFormat?: unknown;
    readonly toolChoice?: unknown;
  }) => {
    params.abortSignal?.throwIfAborted();
    let maximum = params.maxOutputTokens;
    if (budget.outputLimits && maximum !== undefined) {
      const choice = params.toolChoice as
        | { type?: string; toolName?: string }
        | undefined;
      const final =
        choice?.type === "tool" && choice.toolName === "think_final_answer";
      maximum = Math.min(
        maximum,
        final ? budget.outputLimits.final : budget.outputLimits.repository,
      );
    }
    if (maximum === undefined || !Number.isSafeInteger(maximum) || maximum <= 0)
      throw new TypeError("Model generation requires a bounded output maximum");
    const reservation = await budget.reserve({
      phase,
      inputBytes: new TextEncoder().encode(
        JSON.stringify({
          prompt: params.prompt,
          tools: params.tools,
          responseFormat: params.responseFormat,
        }),
      ).byteLength,
      outputTokens: maximum,
    });
    if (reservation === undefined) throw new Error("Review run is obsolete");
    if (!reservation.accepted)
      throw new ModelReviewBudgetExceededError(reservation);
    params.abortSignal?.throwIfAborted();
    return reservation;
  };
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v4",
      wrapGenerate: async ({ params, model: provider }) => {
        const reservation = await reserve(params);
        const result = await provider.doGenerate({
          ...params,
          maxOutputTokens: reservation.outputTokens,
        });
        const outputTokens = result.usage.outputTokens.total;
        if (
          outputTokens !== undefined &&
          Number.isSafeInteger(outputTokens) &&
          outputTokens >= 0
        )
          await budget.settle(reservation.id, outputTokens);
        return result;
      },
      wrapStream: async ({ params, model: provider }) => {
        const reservation = await reserve(params);
        const result = await provider.doStream({
          ...params,
          maxOutputTokens: reservation.outputTokens,
        });
        return {
          ...result,
          stream: result.stream.pipeThrough(
            new TransformStream({
              async transform(part, controller) {
                if (part.type === "finish") {
                  const outputTokens = part.usage.outputTokens.total;
                  if (
                    outputTokens !== undefined &&
                    Number.isSafeInteger(outputTokens) &&
                    outputTokens >= 0
                  )
                    await budget.settle(reservation.id, outputTokens);
                }
                controller.enqueue(part);
              },
            }),
          ),
        };
      },
    },
  });
}
