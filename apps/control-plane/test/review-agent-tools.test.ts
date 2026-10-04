import type { RepositoryToolOutcome } from "@holon/contracts";
import type { RunId } from "@holon/domain";
import { expect, it, vi } from "vitest";

import { ReviewAgent } from "../src/review-agent.js";

const runId =
  `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}` as RunId;
const config = {
  deadlineAt: Date.now() + 60_000,
  phase: "investigation" as const,
  prKey: "github:42:pr:7",
  prompt: "review",
  runId,
  shardIndex: 0,
  totalShards: 1,
};

function harness(
  outcomes: RepositoryToolOutcome[],
  reserve = true,
  phase: "investigation" | "causal_verification" = "investigation",
) {
  const dispose = vi.fn();
  const cancel = vi.fn(async () => {});
  const startTool = vi.fn(async () => ({
    result: async () => outcomes.shift(),
    cancel,
    [Symbol.dispose]: dispose,
  }));
  const reserveAnalysisToolCall = vi.fn(async () => reserve);
  const agent = Object.assign(Object.create(ReviewAgent.prototype), {
    getConfig: () => ({ ...config, phase }),
    isReviewAuthorized: async () => true,
    env: {
      REPOSITORY_EXECUTOR: { startTool },
      REVIEW_LEDGERS: { getByName: () => ({ reserveAnalysisToolCall }) },
    },
  }) as ReviewAgent;
  const execute = agent.getTools().read_file.execute as unknown as (
    input: { path: string },
    options: { abortSignal?: AbortSignal },
  ) => Promise<unknown>;
  return {
    agent,
    cancel,
    dispose,
    execute,
    reserveAnalysisToolCall,
    startTool,
  };
}

it("allows a corrected query after a safe rejection but stops on infrastructure failure", async () => {
  const { agent, dispose, execute, startTool } = harness([
    { error: { kind: "query", code: "path_unavailable" } },
    { content: "safe", truncated: false },
    { error: { kind: "infrastructure", code: "repository_unavailable" } },
  ]);
  await expect(execute({ path: "missing.ts" }, {})).rejects.toThrow(
    "path_unavailable",
  );
  expect(() => agent.beforeStep()).not.toThrow();
  await expect(execute({ path: "valid.ts" }, {})).resolves.toMatchObject({
    content: "safe",
  });
  await expect(execute({ path: "later.ts" }, {})).rejects.toThrow(
    "repository_unavailable",
  );
  expect(() => agent.onStepEnd()).toThrow("repository_unavailable");
  expect(startTool).toHaveBeenCalledTimes(3);
  expect(dispose).toHaveBeenCalledTimes(3);
});

it.each(["investigation", "causal_verification"] as const)(
  "stops %s before touching the executor when the durable tool ceiling is reached",
  async (phase) => {
    const { agent, execute, startTool, reserveAnalysisToolCall } = harness(
      [],
      false,
      phase,
    );
    await expect(execute({ path: "src/index.ts" }, {})).rejects.toThrow(
      "Review tool budget exhausted",
    );
    expect(startTool).not.toHaveBeenCalled();
    expect(reserveAnalysisToolCall).toHaveBeenCalledWith(
      runId,
      config.shardIndex,
      config.totalShards,
    );
    expect(() => agent.beforeStep()).toThrow("Review tool budget exhausted");
  },
);

it("refuses repository reads after the run loses authorization", async () => {
  const { agent, execute, startTool, reserveAnalysisToolCall } = harness([]);
  agent.isReviewAuthorized = async () => false;
  await expect(execute({ path: "src/index.ts" }, {})).rejects.toThrow(
    "Review run is obsolete",
  );
  expect(reserveAnalysisToolCall).not.toHaveBeenCalled();
  expect(startTool).not.toHaveBeenCalled();
});

it("cancels and disposes an in-flight repository operation when the turn aborts", async () => {
  const { execute, startTool } = harness([]);
  const controller = new AbortController();
  const dispose = vi.fn();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let rejectResult!: (error: Error) => void;
  const cancel = vi.fn(async () => {
    rejectResult(new DOMException("Cancelled", "AbortError"));
  });
  startTool.mockImplementation(async () => ({
    result: () =>
      new Promise<never>((_resolve, reject) => {
        rejectResult = reject;
        started();
      }),
    cancel,
    [Symbol.dispose]: dispose,
  }));
  const pending = execute(
    { path: "src/index.ts" },
    { abortSignal: controller.signal },
  );
  const rejected = expect(pending).rejects.toThrow();
  await ready;
  controller.abort();
  await rejected;
  expect(cancel).toHaveBeenCalledOnce();
  expect(dispose).toHaveBeenCalledOnce();
});

it("disables message and tool payload storage when tracing payloads are turned off", async () => {
  const agent = Object.assign(Object.create(ReviewAgent.prototype), {
    env: { AGENT_TRACE_PAYLOADS: "disabled" },
    getConfig: () => config,
    getSystemPrompt: () => "Read-only review instructions",
    isReviewAuthorized: async () => true,
  }) as ReviewAgent;
  const turn = await agent.beforeTurn(
    {} as Parameters<ReviewAgent["beforeTurn"]>[0],
  );
  expect(agent.storeMessages).toBe(false);
  expect(agent.storeTools).toBe(false);
  expect(turn.instructions).toBe("Read-only review instructions");
});

it("cancels only active submissions when a shard is stopped", async () => {
  const listSubmissions = vi.fn(async () => [
    { submissionId: "pending" },
    { submissionId: "running" },
  ]);
  const cancelSubmission = vi.fn(async () => {});
  const agent = Object.assign(Object.create(ReviewAgent.prototype), {
    listSubmissions,
    cancelSubmission,
  }) as ReviewAgent;
  await agent.cancelReview();
  expect(listSubmissions).toHaveBeenCalledWith({
    status: ["pending", "running"],
    limit: 100,
  });
  expect(cancelSubmission).toHaveBeenCalledTimes(2);
  expect(cancelSubmission).toHaveBeenCalledWith("pending", "Review cancelled");
  expect(cancelSubmission).toHaveBeenCalledWith("running", "Review cancelled");
});
