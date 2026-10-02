import type {
  ModelGenerationReservation,
  ModelGenerationAdmission,
} from "@holon/contracts";
import { wrapLanguageModel, type LanguageModel } from "ai";

export interface ModelGenerationBudget {
  reserve(
    request: Omit<ModelGenerationReservation, "shardIndex" | "shardCount">,
  ): Promise<ModelGenerationAdmission>;
  settle(id: number, outputTokens: number): Promise<void>;
}
export class ModelReviewBudgetExceededError extends Error {
  public constructor(
    public readonly admission: Extract<
      ModelGenerationAdmission,
      { accepted: false }
    >,
  ) {
    super("Aggregate review generation budget exhausted");
    this.name = "ModelReviewBudgetExceededError";
  }
}
export function withGenerationBudget(
  model: Exclude<LanguageModel, string>,
  budget?: ModelGenerationBudget,
  phase: ModelGenerationReservation["phase"] = "investigation",
) {
  if (!budget) return model;
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v4",
      wrapGenerate: async ({ params, model: provider }) => {
        params.abortSignal?.throwIfAborted();
        const maximum = params.maxOutputTokens;
        if (
          maximum === undefined ||
          !Number.isSafeInteger(maximum) ||
          maximum <= 0
        )
          throw new TypeError(
            "Model generation requires a bounded output maximum",
          );
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
        if (!reservation.accepted)
          throw new ModelReviewBudgetExceededError(reservation);
        params.abortSignal?.throwIfAborted();
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
    },
  });
}
