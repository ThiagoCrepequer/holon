import { Think } from "@cloudflare/think";
import type { ReviewRun, RunId } from "@holon/domain";
import { getAgentByName } from "agents";
import { MockLanguageModelV4 } from "ai/test";
import { evictDurableObject, reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";

import type { ReviewAgent } from "../src/review/review-agent.js";

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
      phase: "investigation" as const,
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
      maxSteps: 4,
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
    await expect(
      instance.startReview({ ...config, phase: "causal_verification" }),
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
      phase: "investigation" as const,
      prKey,
      prompt: "review",
      runId,
      shardIndex: 1,
      totalShards: 2,
    });
    expect(await instance.isReviewAuthorized()).toBe(false);
    await expect(instance.prepareSummaryRecovery()).rejects.toThrow("obsolete");
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
        phase: "investigation" as const,
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
        phase: "investigation" as const,
        prKey,
        prompt: "review",
        runId,
        shardIndex: 0,
        totalShards: 1,
      }),
    ).rejects.toThrow("Review run is obsolete");
  });
});

it.each(["clean", "unevidenced", "missing_final"] as const)(
  "preserves the structured Think prompt outcome: %s",
  async (scenario) => {
    const unevidenced = scenario === "unevidenced";
    const missingFinal = scenario === "missing_final";
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
            if (!missingFinal)
              controller.enqueue({
                type: "tool-call",
                toolCallId: "final-answer",
                toolName: "think_final_answer",
                input: JSON.stringify({
                  findings: unevidenced
                    ? Array.from({ length: 2 }, () => ({
                        confidence: 0.9,
                        diagnostic:
                          "Removing this guard permits an unauthorized write.",
                        evidence: [],
                        location: {
                          path: "src/a.ts",
                          line: 10,
                          side: "RIGHT",
                          startLine: null,
                        },
                        severity: "high",
                        suggestion: null,
                      }))
                    : [],
                  isDegraded: false,
                  outputLimitations: [],
                  resolutions: [],
                  investigations: [],
                  summary: "No verified regressions.",
                }),
              });
            controller.enqueue({
              type: "finish",
              finishReason: missingFinal
                ? { unified: "stop", raw: "stop" }
                : { unified: "tool-calls", raw: "tool_calls" },
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
    const shardIndex = missingFinal ? 4 : unevidenced ? 3 : 2;
    const agent = await getAgentByName(
      env.REVIEW_AGENTS,
      `${runId}:${shardIndex}`,
    );
    const workflowId = await runInDurableObject(
      agent,
      async (instance: ReviewAgent) => {
        vi.spyOn(instance, "getModel").mockReturnValue(model);
        return await instance.startReview({
          deadlineAt: Date.now() + 60_000,
          phase: "investigation" as const,
          prKey,
          prompt: "Review this changed line.",
          runId,
          shardIndex,
          totalShards: 5,
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
    expect(status).toMatchObject(
      missingFinal
        ? {
            status: "errored",
            error: {
              name: "WorkflowFatalError",
            },
          }
        : {
            status: "complete",
            output: unevidenced
              ? {
                  findings: [],
                  isDegraded: true,
                  outputLimitations: ["evidence_rejected"],
                }
              : { findings: [], summary: "No verified regressions." },
          },
    );
    if (missingFinal) {
      await evictDurableObject(agent);
      expect(await agent.getReviewFailure()).toBe("model_output_missing");
    }
    expect(model.doStreamCalls).toHaveLength(1);
  },
  15_000,
);

it("bounds all phases and reserves narrative output inside each admitted shard allocation", async () => {
  const agent = await getAgentByName(
    env.REVIEW_AGENTS,
    `${runId}:phase-limits`,
  );
  await runInDurableObject(agent, async (instance: ReviewAgent) => {
    vi.spyOn(instance, "isReviewAuthorized").mockResolvedValue(true);
    const config = {
      deadlineAt: Date.now() + 60_000,
      phase: "investigation" as const,
      prKey,
      prompt: "review",
      runId,
      shardIndex: 0,
      totalShards: 9,
    };
    instance.configure(config);
    const investigation = await instance.beforeTurn(
      {} as Parameters<ReviewAgent["beforeTurn"]>[0],
    );
    instance.configure({ ...config, phase: "causal_verification" });
    const causal = await instance.beforeTurn(
      {} as Parameters<ReviewAgent["beforeTurn"]>[0],
    );
    instance.configure(config);
    await instance.prepareSummaryRecovery();
    const recovery = await instance.beforeTurn(
      {} as Parameters<ReviewAgent["beforeTurn"]>[0],
    );
    expect(investigation.maxSteps).toBe(4);
    expect(causal.maxSteps).toBe(2);
    expect(recovery).toMatchObject({
      maxSteps: 1,
      maxOutputTokens: 1024,
      activeTools: ["think_final_answer"],
    });
    expect(
      investigation.maxOutputTokens * 4 +
        causal.maxOutputTokens * 2 +
        recovery.maxOutputTokens,
    ).toBeLessThanOrEqual(Math.floor(120_000 / 9));
    expect(investigation).not.toHaveProperty("toolChoice");
    expect(causal).not.toHaveProperty("toolChoice");
  });
});

it("upgrades persisted Agent state before reading a failure after eviction", async () => {
  const agent = await getAgentByName(
    env.REVIEW_AGENTS,
    `${runId}:state-upgrade`,
  );
  await runInDurableObject(agent, (instance: ReviewAgent) => {
    // The deployed state before this change had only summaryRecovery.
    instance.setState({ summaryRecovery: true } as ReviewAgent["state"]);
  });
  await evictDurableObject(agent);
  expect(await agent.getReviewFailure()).toBeNull();
  await runInDurableObject(agent, async (instance: ReviewAgent) => {
    expect(instance.state.summaryRecovery).toBe(true);
    expect(instance.state).toHaveProperty("reviewFailure", null);
    await expect(
      instance.recordReviewFailure("untrusted provider payload"),
    ).rejects.toThrow();
    await instance.recordReviewFailure("model_shard_budget_exhausted");
    await instance.recordReviewFailure("model_output_missing");
  });
  await evictDurableObject(agent);
  expect(await agent.getReviewFailure()).toBe("model_shard_budget_exhausted");
});

it("emits allowlisted step telemetry without payload content and clarifies final answer in prompt", async () => {
  const agent = await getAgentByName(env.REVIEW_AGENTS, `${runId}:telemetry`);
  await runInDurableObject(agent, async (instance: ReviewAgent) => {
    const config = {
      deadlineAt: Date.now() + 60_000,
      phase: "investigation" as const,
      prKey,
      prompt: "review",
      runId,
      shardIndex: 0,
      totalShards: 1,
    };
    instance.configure(config);

    expect(instance.getSystemPrompt()).toContain(
      "Repository tools are limited to read_file, search_text and search_structure",
    );
    expect(instance.getSystemPrompt()).toContain(
      "Submit the structured final answer using think_final_answer before the step limit",
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      type StepContextType = NonNullable<
        Parameters<ReviewAgent["onStepEnd"]>[0]
      >;
      const contextFixture = {
        stepNumber: 2,
        text: "PRIVATE SECRET CODE DO NOT LEAK",
        reasoningText: "PRIVATE REASONING CHAIN",
        toolCalls: [
          {
            type: "tool-call",
            dynamic: true,
            toolName: "read_file",
            toolCallId: "c1",
            input: { secretPath: "/etc/passwd" },
          },
          {
            type: "tool-call",
            dynamic: true,
            toolName: "malicious_tool",
            toolCallId: "c2",
            input: { rm: "-rf" },
          },
        ],
        finishReason: "tool-calls",
        rawFinishReason: "raw-private-reason",
        usage: {
          inputTokens: 100,
          inputTokenDetails: {
            noCacheTokens: 100,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
          outputTokens: 25,
          outputTokenDetails: { textTokens: 10, reasoningTokens: 15 },
          totalTokens: 125,
        },
      } satisfies Pick<
        StepContextType,
        | "stepNumber"
        | "text"
        | "reasoningText"
        | "toolCalls"
        | "finishReason"
        | "rawFinishReason"
        | "usage"
      >;

      instance.onStepEnd(contextFixture as StepContextType);

      expect(logSpy).toHaveBeenCalledTimes(1);
      const rawLog = logSpy.mock.calls[0]?.[0];
      if (typeof rawLog !== "string")
        throw new Error("Step telemetry is missing");
      const logged = JSON.parse(rawLog);
      expect(logged).toEqual({
        event: "model.step_finished",
        runId,
        shardIndex: 0,
        phase: "investigation",
        summaryRecovery: false,
        stepNumber: 2,
        finishReason: "tool-calls",
        tools: "read_file",
        inputTokens: 100,
        outputTokens: 25,
        reasoningTokens: 15,
        totalTokens: 125,
      });

      expect(rawLog).not.toContain("PRIVATE SECRET CODE");
      expect(rawLog).not.toContain("PRIVATE REASONING CHAIN");
      expect(rawLog).not.toContain("/etc/passwd");
      expect(rawLog).not.toContain("malicious_tool");
      expect(rawLog).not.toContain("raw-private-reason");

      // Verify unallowlisted finishReason maps to "unknown" and invalid token counts are omitted
      logSpy.mockClear();
      instance.onStepEnd({
        stepNumber: 3,
        finishReason: "custom-unsupported-reason",
        toolCalls: [],
        usage: {
          inputTokens: -1,
          outputTokens: Number.NaN,
        },
      } as unknown as NonNullable<StepContextType>);

      expect(logSpy).toHaveBeenCalledTimes(1);
      const secondLogged = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
      expect(secondLogged).toMatchObject({
        finishReason: "unknown",
        tools: "",
      });
      expect(secondLogged).not.toHaveProperty("inputTokens");
      expect(secondLogged).not.toHaveProperty("outputTokens");
    } finally {
      logSpy.mockRestore();
    }

    const errorSpy = vi.spyOn(console, "log").mockImplementation(() => {
      throw new Error("Telemetry transport failed");
    });
    try {
      expect(() =>
        instance.onStepEnd({} as Parameters<ReviewAgent["onStepEnd"]>[0]),
      ).not.toThrow();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
