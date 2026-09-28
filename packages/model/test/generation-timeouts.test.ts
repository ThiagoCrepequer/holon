import { APICallError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, expect, it, vi } from "vitest";

import type { RepositoryToolRunner } from "../src/reviewer.js";

const provider = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: () => provider.model,
}));
import { TwoPhaseReviewGenerator } from "../src/ai-sdk.js";
import { type GenerationEvent } from "../src/generation-execution.js";

const output = { findings: [], summary: "Analysis complete" };
const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  finishReason: { unified: "stop" as const, raw: "stop" },
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 10, text: 10, reasoning: 0 },
  },
  warnings: [],
});
function delayed<T>(value: T, milliseconds: number, signal?: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve(value);
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
const request = {
  instructions: "Review",
  prompt: "private patch",
  evidenceCandidates: [],
  investigationPaths: [],
};
function generator(
  model: MockLanguageModelV3,
  observer?: (event: GenerationEvent) => void,
  run: RepositoryToolRunner["run"] = async () => ({
    content: "private tool result",
    truncated: false,
  }),
) {
  provider.model.mockReturnValue(model);
  return new TwoPhaseReviewGenerator(
    {
      accountId: "account",
      apiToken: "secret",
      gatewayId: "gateway",
      model: "dynamic/review",
    },
    { run },
    undefined,
    "domain",
    observer,
  );
}
afterEach(() => vi.useRealTimers());

it("closes tool access at 24 uncached calls and keeps forced completion incomplete", async () => {
  let calls = 0;
  const run = vi.fn(async () => ({ content: "source", truncated: false }));
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      const index = calls++;
      if (index === 0)
        return {
          ...textResult(""),
          content: Array.from({ length: 24 }, (_, i) => ({
            type: "tool-call" as const,
            toolCallId: `call-${i}`,
            toolName: "read_file",
            input: JSON.stringify({ path: `src/f${i}.ts` }),
          })),
          finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
        };
      if (index === 1) {
        expect(options.toolChoice).toEqual({ type: "none" });
        expect(JSON.stringify(options.prompt)).toContain(
          "0 uncached repository calls remaining",
        );
      }
      return textResult(
        index === 1 ? "Cannot finish pending checks" : JSON.stringify(output),
      );
    },
  });
  const result = await generator(model, undefined, run).generate(request);
  expect(run).toHaveBeenCalledTimes(24);
  expect(calls).toBe(3);
  expect(result).toMatchObject({
    isDegraded: true,
    outputLimitations: ["investigation_incomplete", "tool_budget_exhausted"],
  });
});

it("allows a seventh investigation round and reserves output space for reasoning", async () => {
  let calls = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      const index = calls++;
      if (index < 7) {
        expect(options.maxOutputTokens).toBe(12_000);
        expect(options.toolChoice).toEqual({ type: "auto" });
        return {
          ...textResult(""),
          content: [
            {
              type: "tool-call" as const,
              toolCallId: `call-${index}`,
              toolName: "read_file",
              input: JSON.stringify({ path: `src/file${index}.ts` }),
            },
          ],
          finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
        };
      }
      return textResult(
        index === 7
          ? "Completed investigation with evidence."
          : JSON.stringify(output),
      );
    },
  });
  const result = await generator(model).generate(request);
  expect(result).toMatchObject({ summary: "Analysis complete" });
  expect(result).not.toHaveProperty("isDegraded", true);
  expect(calls).toBe(9);
});

it("allows a 75 second investigation call within the analysis budget", async () => {
  vi.useFakeTimers();
  let call = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async ({ abortSignal }) =>
      delayed(
        textResult(
          call++ === 0 ? "Completed investigation" : JSON.stringify(output),
        ),
        75_000,
        abortSignal,
      ),
  });
  const result = generator(model).generate(request);
  const assertion = expect(result).resolves.toEqual(output);
  await Promise.all([vi.advanceTimersByTimeAsync(150_000), assertion]);
});

it("recovers a timed out finalization without repeating the investigation", async () => {
  vi.useFakeTimers();
  let call = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async ({ abortSignal }) => {
      const index = call++;
      return delayed(
        textResult(
          index === 0 ? "Completed investigation" : JSON.stringify(output),
        ),
        index === 1 ? 240_000 : 10,
        abortSignal,
      );
    },
  });
  const result = generator(model).generate(request);
  const assertion = expect(result).resolves.toEqual(output);
  await Promise.all([vi.advanceTimersByTimeAsync(200_000), assertion]);
  expect(call).toBe(3);
});

it("resumes from completed tool rounds after timeout and logs only operational metadata", async () => {
  vi.useFakeTimers();
  let call = 0;
  const events: GenerationEvent[] = [];
  const run = vi.fn(async () => ({
    content: "private tool result",
    truncated: false,
  }));
  const model = new MockLanguageModelV3({
    doGenerate: async ({ abortSignal }) => {
      const index = call++;
      if (index === 0)
        return {
          ...textResult(""),
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "read_file",
              input: JSON.stringify({ path: "secret.ts" }),
            },
          ],
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
        };
      return delayed(
        textResult(
          index < 3 ? "Investigation complete" : JSON.stringify(output),
        ),
        index === 1 ? 240_000 : 10,
        abortSignal,
      );
    },
  });
  const result = generator(model, (event) => events.push(event), run).generate(
    request,
  );
  await Promise.all([
    vi.advanceTimersByTimeAsync(200_000),
    expect(result).resolves.toEqual(output),
  ]);
  expect(run).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(model.doGenerateCalls[2]?.prompt)).toContain(
    "private tool result",
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      event: "model.phase_failed",
      reason: "generation_step_timeout",
      phase: "investigation",
      round: 2,
    }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({ event: "model.recovery_scheduled", attempt: 2 }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      event: "model.round_finished",
      phase: "finalization",
    }),
  );
  expect(JSON.stringify(events)).not.toMatch(
    /private|secret.ts|Completed investigation/,
  );
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps an exhausted investigation incomplete even if finalization returns a clean object", async () => {
  vi.useFakeTimers();
  let call = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async ({ abortSignal }) => {
      const index = call++;
      return delayed(
        textResult(JSON.stringify(output)),
        index < 2 ? 240_000 : 10,
        abortSignal,
      );
    },
  });
  const result = generator(model).generate(request);
  await Promise.all([
    vi.advanceTimersByTimeAsync(370_000),
    expect(result).resolves.toMatchObject({
      isDegraded: true,
      outputLimitations: ["investigation_incomplete"],
    }),
  ]);
  expect(call).toBe(3);
});

it("does not invoke a model after the shared deadline or grant a fresh recovery budget", async () => {
  vi.useFakeTimers();
  const model = new MockLanguageModelV3({
    doGenerate: textResult(JSON.stringify(output)),
  });
  const events: GenerationEvent[] = [];
  const result = await generator(model, (event) => events.push(event)).generate(
    { ...request, deadlineAt: Date.now() - 1 },
  );
  expect(result).toMatchObject({
    isDegraded: true,
    findings: [],
    outputLimitations: ["investigation_incomplete", "finalization_failed"],
  });
  expect(model.doGenerateCalls).toHaveLength(0);
  expect(events).toContainEqual(
    expect.objectContaining({
      phase: "recovery",
      reason: "insufficient_recovery_budget",
    }),
  );
});

it("does not let a logging failure alter a successful review", async () => {
  const model = new MockLanguageModelV3({
    doGenerate: [
      textResult("Investigation"),
      textResult(JSON.stringify(output)),
    ],
  });
  await expect(
    generator(model, () => {
      throw new Error("log sink unavailable");
    }).generate(request),
  ).resolves.toEqual(output);
});

it("degrades instead of throwing when both finalization attempts time out", async () => {
  vi.useFakeTimers();
  let call = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async ({ abortSignal }) =>
      delayed(
        textResult("Investigation"),
        call++ === 0 ? 10 : 240_000,
        abortSignal,
      ),
  });
  const result = generator(model).generate(request);
  await Promise.all([
    vi.advanceTimersByTimeAsync(370_000),
    expect(result).resolves.toMatchObject({
      isDegraded: true,
      findings: [],
      outputLimitations: ["finalization_failed"],
    }),
  ]);
  expect(call).toBe(3);
});

it("enforces the fixed phase deadline across slow successful rounds", async () => {
  vi.useFakeTimers();
  let call = 0;
  const events: GenerationEvent[] = [];
  const model = new MockLanguageModelV3({
    doGenerate: async ({ abortSignal }) => {
      const index = call++;
      if (index > 3) return textResult(JSON.stringify(output));
      return delayed(
        {
          ...textResult("Partial investigation"),
          content: [
            {
              type: "tool-call" as const,
              toolCallId: `call-${index}`,
              toolName: "read_file",
              input: JSON.stringify({ path: "file.ts" }),
            },
          ],
          finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
        },
        170_000,
        abortSignal,
      );
    },
  });
  const result = generator(model, (event) => events.push(event)).generate(
    request,
  );
  await Promise.all([
    vi.advanceTimersByTimeAsync(541_000),
    expect(result).resolves.toMatchObject({
      isDegraded: true,
      outputLimitations: ["investigation_incomplete"],
    }),
  ]);
  expect(events).toContainEqual(
    expect.objectContaining({
      event: "model.phase_failed",
      reason: "phase_budget_exhausted",
      durationMs: 540_000,
    }),
  );
  expect(call).toBe(5);
});

it("retries a transient provider failure once and preserves the successful recovery", async () => {
  let call = 0;
  const events: GenerationEvent[] = [];
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      const index = call++;
      if (index === 0)
        throw new APICallError({
          message: "private provider error",
          url: "https://private.invalid",
          requestBodyValues: {},
          statusCode: 503,
          isRetryable: true,
        });
      return textResult(
        index === 1 ? "Complete investigation" : JSON.stringify(output),
      );
    },
  });
  await expect(
    generator(model, (event) => events.push(event)).generate(request),
  ).resolves.toEqual(output);
  expect(call).toBe(3);
  expect(events).toContainEqual(
    expect.objectContaining({
      reason: "provider_transient",
      phase: "investigation",
      attempt: 1,
    }),
  );
  expect(JSON.stringify(events)).not.toContain("private");
});

it("keeps persistent provider failures incomplete with a bounded number of attempts", async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      throw new APICallError({
        message: "unavailable",
        url: "https://provider.invalid",
        requestBodyValues: {},
        statusCode: 503,
        isRetryable: true,
      });
    },
  });
  await expect(generator(model).generate(request)).resolves.toMatchObject({
    isDegraded: true,
    outputLimitations: ["investigation_incomplete", "finalization_failed"],
  });
  expect(model.doGenerateCalls).toHaveLength(4);
});

it("does not invoke synthesis after its shared deadline", async () => {
  const model = new MockLanguageModelV3({
    doGenerate: textResult("Should not be called"),
  });
  const result = await generator(model).synthesizeSummary(
    ["one", "two"],
    [],
    undefined,
    Date.now() - 1,
  );
  expect(result).not.toContain("Should not be called");
  expect(model.doGenerateCalls).toHaveLength(0);
});

it("closes repeated cached requests after three rounds without progress", async () => {
  let calls = 0;
  const events: GenerationEvent[] = [];
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      const index = calls++;
      if (index < 4)
        return {
          ...textResult(""),
          content: [
            {
              type: "tool-call" as const,
              toolCallId: `call-${index}`,
              toolName: "read_file",
              input: JSON.stringify({ path: "src/same.ts" }),
            },
          ],
          finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
        };
      if (index === 4) {
        expect(options.toolChoice).toEqual({ type: "none" });
        return textResult(
          "Verified completed work; further investigation remains pending.",
        );
      }
      return textResult(JSON.stringify(output));
    },
  });
  const result = await generator(model, (event) => events.push(event)).generate(
    request,
  );
  expect(result).toMatchObject({
    isDegraded: true,
    outputLimitations: ["investigation_incomplete"],
  });
  expect(events).toContainEqual(
    expect.objectContaining({
      event: "model.investigation_stopped",
      reason: "no_progress",
      round: 5,
      toolCalls: 1,
    }),
  );
  expect(calls).toBe(6);
});

it("continues twelve productive rounds without forcing an incomplete review", async () => {
  let calls = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      const index = calls++;
      if (index < 12)
        return {
          ...textResult(""),
          content: [
            {
              type: "tool-call",
              toolCallId: `call-${index}`,
              toolName: "read_file",
              input: JSON.stringify({ path: `src/f${index}.ts` }),
            },
          ],
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
        };
      return textResult(
        index === 12 ? "Investigation complete" : JSON.stringify(output),
      );
    },
  });
  const result = await generator(model).generate(request);
  expect(result).not.toHaveProperty("isDegraded", true);
  expect(calls).toBe(14);
});

it("propagates cancellation to repository tools instead of waiting for their full duration", async () => {
  vi.useFakeTimers();
  let calls = 0;
  let aborted = false;
  const model = new MockLanguageModelV3({
    doGenerate: async () =>
      calls++ === 0
        ? {
            ...textResult(""),
            content: [
              {
                type: "tool-call",
                toolCallId: "slow",
                toolName: "read_file",
                input: JSON.stringify({ path: "src/slow.ts" }),
              },
            ],
            finishReason: { unified: "tool-calls", raw: "tool_calls" },
          }
        : textResult(
            calls === 2 ? "Investigation incomplete" : JSON.stringify(output),
          ),
  });
  const events: GenerationEvent[] = [];
  const run: RepositoryToolRunner["run"] = async (_call, options) => {
    try {
      return await delayed(
        { content: "source", truncated: false },
        360_000,
        options?.abortSignal,
      );
    } catch (error) {
      aborted = true;
      throw error;
    }
  };
  const pending = generator(model, (event) => events.push(event), run).generate(
    request,
  );
  await vi.advanceTimersByTimeAsync(180_001);
  expect(aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(360_000);
  await pending;
});

it("reserves synthesis output before the cumulative output budget is exhausted", async () => {
  let calls = 0;
  const events: GenerationEvent[] = [];
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      const index = calls++;
      if (index < 9)
        return {
          ...textResult(""),
          usage: {
            inputTokens: textResult("").usage.inputTokens,
            outputTokens: {
              ...textResult("").usage.outputTokens,
              total: 12_000,
            },
          },
          content: [
            {
              type: "tool-call",
              toolCallId: `large-${index}`,
              toolName: "read_file",
              input: JSON.stringify({ path: `src/f${index}.ts` }),
            },
          ],
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
        };
      if (index === 9) expect(options.toolChoice).toEqual({ type: "none" });
      return textResult(
        index === 9 ? "Further investigation pending" : JSON.stringify(output),
      );
    },
  });
  const result = await generator(model, (event) => events.push(event)).generate(
    request,
  );
  expect(result).toHaveProperty("isDegraded", true);
  expect(events).toContainEqual(
    expect.objectContaining({
      reason: "output_budget_exhausted",
      toolCalls: 9,
      round: 10,
    }),
  );
  expect(calls).toBe(11);
});

const checkpointResult = (finished = true, status = "reviewed") => ({
  ...textResult(""),
  content: [
    {
      type: "tool-call" as const,
      toolCallId: "checkpoint",
      toolName: "review_checkpoint",
      input: JSON.stringify({
        checks: [
          {
            id: "file-0",
            status,
            note: "Compared changed contract and relevant callers",
          },
        ],
        summary: "No confirmed defect",
        finished,
      }),
    },
  ],
  finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
});
it("completes through a checkpoint without an extra narrative model call", async () => {
  let calls = 0;
  const events: GenerationEvent[] = [];
  const model = new MockLanguageModelV3({
    doGenerate: async () =>
      calls++ === 0 ? checkpointResult() : textResult(JSON.stringify(output)),
  });
  const result = await generator(model, (event) => events.push(event)).generate(
    { ...request, investigationPaths: ["src/a.ts"] },
  );
  expect(calls).toBe(2);
  expect(result).not.toMatchObject({ isDegraded: true });
  expect(events).toContainEqual(
    expect.objectContaining({
      event: "model.investigation_progress",
      reviewedChecks: 1,
      pendingChecks: 0,
      toolCalls: 0,
      reasoningTokens: 0,
    }),
  );
  expect(JSON.stringify(events)).not.toContain("src/a.ts");
});
it.each(["pending", "blocked"])(
  "preserves %s coverage even when finalization claims a clean review",
  async (status) => {
    let calls = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () =>
        calls++ === 0
          ? checkpointResult(true, status)
          : textResult(JSON.stringify(output)),
    });
    const result = await generator(model).generate({
      ...request,
      investigationPaths: ["src/a.ts"],
    });
    expect(result).toMatchObject({
      isDegraded: true,
      outputLimitations: ["investigation_incomplete"],
    });
  },
);
it("does not accept completion emitted together with unread repository results", async () => {
  let calls = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      const index = calls++;
      if (index === 0) {
        const checkpoint = checkpointResult();
        return {
          ...checkpoint,
          content: [
            ...checkpoint.content,
            {
              type: "tool-call" as const,
              toolCallId: "read",
              toolName: "read_file",
              input: JSON.stringify({ path: "src/a.ts" }),
            },
          ],
        };
      }
      return textResult(index === 1 ? "All done" : JSON.stringify(output));
    },
  });
  const result = await generator(model).generate({
    ...request,
    investigationPaths: ["src/a.ts"],
  });
  expect(calls).toBe(3);
  expect(result).toMatchObject({
    isDegraded: true,
    outputLimitations: ["investigation_incomplete"],
  });
});
it("reserves closure before another long generation can consume the phase deadline", async () => {
  vi.useFakeTimers();
  let calls = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      const index = calls++;
      if (index === 0)
        return delayed(
          {
            ...textResult(""),
            content: [
              {
                type: "tool-call" as const,
                toolCallId: "read",
                toolName: "read_file",
                input: JSON.stringify({ path: "src/a.ts" }),
              },
            ],
            finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
          },
          150_000,
          options.abortSignal,
        );
      if (index === 1) {
        expect(options.tools?.map((t) => t.name)).toEqual([
          "review_checkpoint",
        ]);
        expect(options.toolChoice).toEqual({
          type: "tool",
          toolName: "review_checkpoint",
        });
        expect(options.maxOutputTokens).toBe(8192);
        return checkpointResult(true, "pending");
      }
      return textResult(JSON.stringify(output));
    },
  });
  // Shared remaining analysis time leaves six minutes for investigation.
  const pending = generator(model).generate({
    ...request,
    investigationPaths: ["src/a.ts"],
    deadlineAt: Date.now() + 14 * 60_000,
  });
  await vi.advanceTimersByTimeAsync(150_000);
  expect(await pending).toMatchObject({
    isDegraded: true,
    outputLimitations: ["investigation_incomplete"],
  });
  expect(calls).toBe(3);
});

it("discards a premature checkpoint when its repository round is cancelled", async () => {
  vi.useFakeTimers();
  let calls = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      const index = calls++;
      if (index === 0) {
        const checkpoint = checkpointResult();
        return {
          ...checkpoint,
          content: [
            ...checkpoint.content,
            {
              type: "tool-call" as const,
              toolCallId: "slow-read",
              toolName: "read_file",
              input: JSON.stringify({ path: "src/a.ts" }),
            },
          ],
        };
      }
      if (index === 1) return textResult("Could not verify the pending file");
      expect(JSON.stringify(options.prompt)).not.toContain(
        "No confirmed defect",
      );
      return textResult(JSON.stringify(output));
    },
  });
  const pending = generator(model, undefined, async (_call, execution) =>
    delayed(
      { content: "late", truncated: false },
      210_000,
      execution?.abortSignal,
    ),
  ).generate({ ...request, investigationPaths: ["src/a.ts"] });
  await vi.advanceTimersByTimeAsync(180_000);
  expect(await pending).toMatchObject({
    isDegraded: true,
    outputLimitations: ["investigation_incomplete"],
  });
  expect(calls).toBe(3);
});
it("keeps length-truncated checkpoint generation incomplete", async () => {
  let calls = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      calls++;
      if (options.responseFormat?.type === "json")
        return textResult(JSON.stringify(output));
      return {
        ...checkpointResult(),
        finishReason: { unified: "length" as const, raw: "length" },
      };
    },
  });
  const result = await generator(model).generate({
    ...request,
    investigationPaths: ["src/a.ts"],
  });
  expect(result).toMatchObject({
    isDegraded: true,
    outputLimitations: expect.arrayContaining([
      "generation_length",
      "investigation_incomplete",
    ]),
  });
  expect(calls).toBe(2);
});
