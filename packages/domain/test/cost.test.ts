import { describe, expect, it } from "vitest";

import {
  calculateInferenceCost,
  resolveModelPricing,
  KNOWN_MODEL_PRICING,
  DEFAULT_MODEL_PRICING,
} from "../src/cost.js";

describe("cost calculation engine", () => {
  it("resolves known models accurately", () => {
    const r1 = resolveModelPricing(
      "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
    );
    expect(r1.rate).toEqual(
      KNOWN_MODEL_PRICING["@cf/deepseek-ai/deepseek-r1-distill-qwen-32b"],
    );

    const sonnet = resolveModelPricing("claude-3-5-sonnet-20241022");
    expect(sonnet.rate).toEqual(KNOWN_MODEL_PRICING["claude-3-5-sonnet"]);

    const gpt4o = resolveModelPricing("gpt-4o-mini");
    expect(gpt4o.rate).toEqual(KNOWN_MODEL_PRICING["gpt-4o-mini"]);
  });

  it("resolves default pricing for unknown or empty models", () => {
    const unknown = resolveModelPricing("custom-private-model");
    expect(unknown.rate).toEqual(DEFAULT_MODEL_PRICING);
    expect(unknown.modelName).toBe("custom-private-model");

    const empty = resolveModelPricing("");
    expect(empty.rate).toEqual(DEFAULT_MODEL_PRICING);
    expect(empty.modelName).toBe("unknown");
  });

  it("calculates cost without reasoning tokens", () => {
    const tokens = {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      totalTokens: 2_000_000,
    };
    const cost = calculateInferenceCost("deepseek-chat", tokens);
    expect(cost.currency).toBe("USD");
    expect(cost.pricingModel).toBe("deepseek-chat");
    // input: 1M * 0.14 = 0.14; output: 1M * 0.28 = 0.28; total: 0.42
    expect(cost.estimatedCostUsd).toBe(0.42);
    expect(cost.estimatedCostMicroUsd).toBe(420000);
  });

  it("calculates cost including reasoning tokens into output pricing", () => {
    const tokens = {
      inputTokens: 500_000,
      outputTokens: 200_000,
      reasoningTokens: 300_000, // effective output: 500,000
      totalTokens: 1_000_000,
    };
    const cost = calculateInferenceCost(
      "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
      tokens,
    );
    // input: 0.5 * 0.55 = 0.275; output: 0.5 * 2.19 = 1.095; total: 1.37
    expect(cost.estimatedCostUsd).toBe(1.37);
    expect(cost.estimatedCostMicroUsd).toBe(1370000);
  });
});
