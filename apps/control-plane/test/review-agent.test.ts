import { Think } from "@cloudflare/think";
import type { ReviewRun, RunId } from "@holon/domain";
import { getAgentByName } from "agents";
import { MockLanguageModelV4 } from "ai/test";
import { reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";

import type { ReviewAgent } from "../src/review-agent.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

const prKey = "github:42:pr:7";
const runId =
  `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}` as RunId;
const run: ReviewRun = {
  attempt: 0,
  causalVersion: "2026-10-03T12:00:00.000Z",
  createdAt: "2026-10-03T12:00:00.000Z",
  id: runId,
  prKey,
  state: "queued",
};

it("admits only the latest running review and exposes only read-only repository tools", async () => {
  const agent = await getAgentByName(env.REVIEW_AGENTS, `${runId}:0`);
  const ledger = env.REVIEW_LEDGERS.getByName(prKey);
  await ledger.claimRun(run, "review-agent-test");
  await ledger.transition(
    runId,
    "queued",
    "running",
    new Date().toISOString(),
    "review-agent-test:start",
  );
  await runInDurableObject(agent, async (instance: ReviewAgent) => {
    const config = {
      deadlineAt: Date.now() + 60_000,
      prKey,
      prompt: "review",
      runId,
      shardIndex: 0,
      totalShards: 1,
    };
    instance.configure(config);
    expect(instance).toBeInstanceOf(Think);
    expect(Object.keys(instance.getTools())).toEqual([
      "read_file",
      "search_structure",
      "search_text",
    ]);
    expect(instance.includeMcpTools).toBe(false);
    expect(instance.workspaceBash).toBe(false);
    const turn = await instance.beforeTurn(
      {} as Parameters<ReviewAgent["beforeTurn"]>[0],
    );
    expect(turn).toMatchObject({
      activeTools: [
        "read_file",
        "search_text",
        "search_structure",
        "think_final_answer",
      ],
      instructions: expect.stringContaining(
        "Never edit code or execute commands",
      ),
    });
    expect(instance.storeMessages).toBe(true);
    expect(instance.storeTools).toBe(true);
    expect(instance.getSystemPrompt()).toContain(
      "Never edit code or execute commands",
    );
    const runWorkflow = vi
      .spyOn(instance, "runWorkflow")
      .mockResolvedValue("workflow-id");
    expect(await instance.startReview(config)).toBe("workflow-id");
    expect(runWorkflow).toHaveBeenCalledWith(
      "REVIEW_SHARD_WORKFLOW",
      { prompt: "review" },
      expect.objectContaining({
        id: expect.stringMatching(/^review-[a-f0-9]{64}$/u),
        agentBinding: "REVIEW_AGENTS",
      }),
    );
    await expect(
      instance.startReview({ ...config, prompt: "different" }),
    ).rejects.toThrow("identity changed");
    const beforeToolCall = (toolName: string) =>
      instance.beforeToolCall({ toolName } as Parameters<
        ReviewAgent["beforeToolCall"]
      >[0]);
    for (const toolName of ["write", "edit", "delete", "bash", "execute"])
      expect(await beforeToolCall(toolName)).toMatchObject({ action: "block" });
    expect(await beforeToolCall("read_file")).toBeUndefined();
  });
  await ledger.transition(
    runId,
    "running",
    "obsolete",
    new Date().toISOString(),
    "review-agent-test:obsolete",
  );
  await runInDurableObject(agent, async (instance: ReviewAgent) => {
    await expect(
      instance.beforeTurn({} as Parameters<ReviewAgent["beforeTurn"]>[0]),
    ).rejects.toThrow("obsolete");
    expect(
      await instance.beforeToolCall({ toolName: "read_file" } as Parameters<
        ReviewAgent["beforeToolCall"]
      >[0]),
    ).toMatchObject({ action: "block", reason: "Review run is obsolete" });
  });
});

it("refuses a turn after its fixed deadline", async () => {
  const agent = await getAgentByName(env.REVIEW_AGENTS, `${runId}:expired`);
  await runInDurableObject(agent, async (instance: ReviewAgent) => {
    instance.configure({
      deadlineAt: Date.now() - 1,
      prKey,
      prompt: "review",
      runId,
      shardIndex: 1,
      totalShards: 2,
    });
    expect(await instance.isReviewAuthorized()).toBe(false);
    await expect(
      instance.beforeTurn({} as Parameters<ReviewAgent["beforeTurn"]>[0]),
    ).rejects.toThrow("obsolete");
  });
});

it("does not start a shard workflow for an expired or obsolete run", async () => {
  const expired = await getAgentByName(
    env.REVIEW_AGENTS,
    `${runId}:expired-start`,
  );
  await runInDurableObject(expired, async (instance: ReviewAgent) => {
    await expect(
      instance.startReview({
        deadlineAt: Date.now() - 1,
        prKey,
        prompt: "review",
        runId,
        shardIndex: 0,
        totalShards: 1,
      }),
    ).rejects.toThrow("deadline passed");
  });
  const obsolete = await getAgentByName(
    env.REVIEW_AGENTS,
    `${runId}:obsolete-start`,
  );
  await runInDurableObject(obsolete, async (instance: ReviewAgent) => {
    await expect(
      instance.startReview({
        deadlineAt: Date.now() + 60_000,
        prKey,
        prompt: "review",
        runId,
        shardIndex: 0,
        totalShards: 1,
      }),
    ).rejects.toThrow("Review run is obsolete");
  });
});

it("completes a Think prompt workflow with a simulated structured model response", async () => {
  const ledger = env.REVIEW_LEDGERS.getByName(prKey);
  await ledger.claimRun(run, "think-prompt-integration");
  await ledger.transition(
    runId,
    "queued",
    "running",
    new Date().toISOString(),
    "think-prompt-integration:start",
  );
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "tool-call",
            toolCallId: "final-answer",
            toolName: "think_final_answer",
            input: JSON.stringify({
              findings: [],
              isDegraded: false,
              outputLimitations: [],
              resolutions: [],
              summary: "No verified regressions.",
            }),
          });
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool_calls" },
            usage: {
              inputTokens: {
                total: 10,
                noCache: 10,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 10, text: 10, reasoning: 0 },
            },
          });
          controller.close();
        },
      }),
    }),
  });
  const agent = await getAgentByName(env.REVIEW_AGENTS, `${runId}:2`);
  const workflowId = await runInDurableObject(
    agent,
    async (instance: ReviewAgent) => {
      vi.spyOn(instance, "getModel").mockReturnValue(model);
      return await instance.startReview({
        deadlineAt: Date.now() + 60_000,
        prKey,
        prompt: "Review this changed line.",
        runId,
        shardIndex: 2,
        totalShards: 3,
      });
    },
  );
  const workflow = await env.REVIEW_SHARD_WORKFLOW.get(workflowId);
  let status = await workflow.status();
  for (
    let attempt = 0;
    attempt < 100 &&
    status.status !== "complete" &&
    status.status !== "errored";
    attempt++
  ) {
    await scheduler.wait(50);
    status = await workflow.status();
  }
  expect(status).toMatchObject({
    status: "complete",
    output: { findings: [], summary: "No verified regressions." },
  });
  expect(model.doStreamCalls).toHaveLength(1);
}, 15_000);
