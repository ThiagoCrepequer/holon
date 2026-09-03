export interface TokenAccountingInput {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens?: number | undefined;
  readonly totalTokens?: number | undefined;
}

export interface CostAccountingResult {
  readonly currency: "USD";
  readonly estimatedCostMicroUsd: number;
  readonly estimatedCostUsd: number;
  readonly pricingModel: string;
}

export interface ModelPricingRate {
  readonly inputPricePerMillion: number;
  readonly outputPricePerMillion: number;
}

export const KNOWN_MODEL_PRICING: Readonly<Record<string, ModelPricingRate>> = {
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b": {
    inputPricePerMillion: 0.55,
    outputPricePerMillion: 2.19,
  },
  "claude-3-5-sonnet": {
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
  },
  "deepseek-chat": {
    inputPricePerMillion: 0.14,
    outputPricePerMillion: 0.28,
  },
  "deepseek-reasoner": {
    inputPricePerMillion: 0.55,
    outputPricePerMillion: 2.19,
  },
  "gpt-4o": {
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10.0,
  },
  "gpt-4o-mini": {
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
  },
};

export const DEFAULT_MODEL_PRICING: ModelPricingRate = {
  inputPricePerMillion: 1.0,
  outputPricePerMillion: 3.0,
};

export function resolveModelPricing(model: string): {
  readonly modelName: string;
  readonly rate: ModelPricingRate;
} {
  const normalized = model.toLowerCase().trim();
  const sortedEntries = Object.entries(KNOWN_MODEL_PRICING).toSorted(
    (a, b) => b[0].length - a[0].length,
  );
  for (const [key, rate] of sortedEntries) {
    if (normalized.includes(key.toLowerCase())) {
      return { modelName: key, rate };
    }
  }
  return { modelName: model || "unknown", rate: DEFAULT_MODEL_PRICING };
}

export function calculateInferenceCost(
  model: string,
  tokens: TokenAccountingInput,
): CostAccountingResult {
  const { modelName, rate } = resolveModelPricing(model);
  const inputCost =
    (tokens.inputTokens / 1_000_000) * rate.inputPricePerMillion;
  const effectiveOutputTokens =
    tokens.outputTokens + (tokens.reasoningTokens ?? 0);
  const outputCost =
    (effectiveOutputTokens / 1_000_000) * rate.outputPricePerMillion;
  const totalCostUsd = inputCost + outputCost;
  const estimatedCostMicroUsd = Math.round(totalCostUsd * 1_000_000);

  return {
    currency: "USD",
    estimatedCostMicroUsd,
    estimatedCostUsd: Number(totalCostUsd.toFixed(6)),
    pricingModel: modelName,
  };
}
