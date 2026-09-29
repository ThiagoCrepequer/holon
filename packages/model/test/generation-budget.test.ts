import { generateText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { expect, it, vi } from "vitest";

import { withGenerationBudget } from "../src/generation-budget.js";
const response = {
  content: [{ type: "text" as const, text: "OK" }],
  finishReason: { unified: "stop" as const, raw: "stop" },
  usage: {
    inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 2, text: 2, reasoning: 0 },
  },
  warnings: [],
};
it("reserves the provider-ready input before inference and settles actual output", async () => {
  const reserve = vi.fn(async () => ({
    accepted: true as const,
    id: 1,
    outputTokens: 20,
  }));
  const settle = vi.fn(async () => {});
  const doGenerate = vi.fn(async () => {
    expect(reserve).toHaveBeenCalledTimes(1);
    return response;
  });
  await generateText({
    model: withGenerationBudget(new MockLanguageModelV3({ doGenerate }), {
      reserve,
      settle,
    }),
    prompt: "Public fixture",
    maxOutputTokens: 20,
    maxRetries: 0,
  });
  expect(reserve).toHaveBeenCalledWith({
    phase: "investigation",
    inputBytes: expect.any(Number),
    outputTokens: 20,
  });
  expect(settle).toHaveBeenCalledWith(1, 2);
});
it("does not contact a provider after aggregate admission fails", async () => {
  const doGenerate = vi.fn(async () => response);
  const settle = vi.fn(async () => {});
  await expect(
    generateText({
      model: withGenerationBudget(new MockLanguageModelV3({ doGenerate }), {
        reserve: async () => ({
          accepted: false as const,
          reason: "calls" as const,
          limit: 64,
          consumed: 64,
          requested: 1,
        }),
        settle,
      }),
      prompt: "Public fixture",
      maxOutputTokens: 20,
      maxRetries: 0,
    }),
  ).rejects.toMatchObject({ name: "ModelReviewBudgetExceededError" });
  expect(doGenerate).not.toHaveBeenCalled();
  expect(settle).not.toHaveBeenCalled();
});
it("keeps uncertain charges and propagates storage failures", async () => {
  const settle = vi.fn(async () => {});
  const failure = new Error("provider failed");
  const doGenerate = vi.fn(async () => {
    throw failure;
  });
  await expect(
    generateText({
      model: withGenerationBudget(new MockLanguageModelV3({ doGenerate }), {
        reserve: async () => ({
          accepted: true as const,
          id: 1,
          outputTokens: 20,
        }),
        settle,
      }),
      prompt: "Public fixture",
      maxOutputTokens: 20,
      maxRetries: 0,
    }),
  ).rejects.toBe(failure);
  expect(settle).not.toHaveBeenCalled();
  const unavailable = new Error("ledger unavailable");
  await expect(
    generateText({
      model: withGenerationBudget(new MockLanguageModelV3({ doGenerate }), {
        reserve: async () => {
          throw unavailable;
        },
        settle,
      }),
      prompt: "Public fixture",
      maxOutputTokens: 20,
      maxRetries: 0,
    }),
  ).rejects.toBe(unavailable);
  expect(doGenerate).toHaveBeenCalledTimes(1);
});

it("rejects unbounded output before reserving or contacting the provider", async () => {
  const reserve = vi.fn(async () => ({
    accepted: true as const,
    id: 1,
    outputTokens: 20,
  }));
  const doGenerate = vi.fn(async () => response);
  await expect(
    generateText({
      model: withGenerationBudget(new MockLanguageModelV3({ doGenerate }), {
        reserve,
        settle: async () => {},
      }),
      prompt: "Public fixture",
      maxRetries: 0,
    }),
  ).rejects.toThrow("bounded output maximum");
  expect(reserve).not.toHaveBeenCalled();
  expect(doGenerate).not.toHaveBeenCalled();
});

it("applies the admitted output maximum to the actual provider call", async () => {
  const doGenerate = vi.fn(async () => response);
  const reserve = vi.fn(async () => ({
    accepted: true as const,
    id: 1,
    outputTokens: 1024,
  }));
  await generateText({
    model: withGenerationBudget(
      new MockLanguageModelV3({ doGenerate }),
      { reserve, settle: async () => {} },
      "finalization",
    ),
    prompt: "Public fixture",
    maxOutputTokens: 8192,
    maxRetries: 0,
  });
  expect(reserve).toHaveBeenCalledWith(
    expect.objectContaining({ phase: "finalization", outputTokens: 8192 }),
  );
  expect(doGenerate).toHaveBeenCalledWith(
    expect.objectContaining({ maxOutputTokens: 1024 }),
  );
});
