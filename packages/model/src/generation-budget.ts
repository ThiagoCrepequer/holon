import type { ModelGenerationReservation } from "@holon/contracts";
import { wrapLanguageModel, type LanguageModel } from "ai";

export interface ModelGenerationBudget {
  reserve(request: ModelGenerationReservation): Promise<number | undefined>;
  settle(id: number, outputTokens: number): Promise<void>;
}
export class ModelReviewBudgetExceededError extends Error {
  public constructor() {
    super("Aggregate review generation budget exhausted");
    this.name = "ModelReviewBudgetExceededError";
  }
}
export function withGenerationBudget(
  model: Exclude<LanguageModel, string>,
  budget?: ModelGenerationBudget,
) {
  if (!budget) return model;
  const reserve = async (params: {
    readonly abortSignal?: AbortSignal;
    readonly maxOutputTokens?: number;
    readonly prompt: unknown;
    readonly tools?: unknown;
    readonly responseFormat?: unknown;
  }) => {
    params.abortSignal?.throwIfAborted();
    const maximum = params.maxOutputTokens;
    if (maximum === undefined || !Number.isSafeInteger(maximum) || maximum <= 0)
      throw new TypeError("Model generation requires a bounded output maximum");
    const reservation = await budget.reserve({
      inputBytes: new TextEncoder().encode(
        JSON.stringify({
          prompt: params.prompt,
          tools: params.tools,
          responseFormat: params.responseFormat,
        }),
      ).byteLength,
      outputTokens: maximum,
    });
    if (reservation === undefined) throw new ModelReviewBudgetExceededError();
    params.abortSignal?.throwIfAborted();
    return reservation;
  };
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v4",
      wrapGenerate: async ({ params, doGenerate }) => {
        const reservation = await reserve(params);
        const result = await doGenerate();
        const outputTokens = result.usage.outputTokens.total;
        if (
          outputTokens !== undefined &&
          Number.isSafeInteger(outputTokens) &&
          outputTokens >= 0
        )
          await budget.settle(reservation, outputTokens);
        return result;
      },
      wrapStream: async ({ params, doStream }) => {
        const reservation = await reserve(params);
        const result = await doStream();
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
                    await budget.settle(reservation, outputTokens);
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
