import type { RunId } from "@holon/domain";
import { getAgentByName } from "agents";
import { MockLanguageModelV4 } from "ai/test";
import { reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";

import type { ReviewAgent } from "../src/review/review-agent.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

it.each([2, 3])(
  "bounds evidence recovery to three reads without repeating inference (%i failures)",
  async (failures) => {
    const prKey = "github:42:pr:761" as const;
    const runId =
      `${prKey}:head:${(failures === 2 ? "d" : "e").repeat(40)}:base:${"b".repeat(40)}` as RunId;
    const ledger = env.REVIEW_LEDGERS.getByName(prKey);
    await ledger.claimRun(
      {
        attempt: 0,
        causalVersion: "2026-10-10T12:00:00Z",
        createdAt: "2026-10-10T12:00:00Z",
        id: runId,
        prKey,
        state: "queued",
      },
      "evidence-recovery",
    );
    await ledger.transition(
      runId,
      "queued",
      "running",
      new Date().toISOString(),
      "evidence-recovery:start",
    );
    const executor = env.REPOSITORY_EXECUTOR as unknown as {
      configureEvidenceFailures(runId: string, count: number): Promise<void>;
      evidenceReadAttempts(runId: string): Promise<number>;
    };
    await executor.configureEvidenceFailures(runId, failures);
    let generations = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        generations++;
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({
                type: "tool-call",
                toolCallId: "final",
                toolName: "think_final_answer",
                input: JSON.stringify({
                  findings: [],
                  investigations:
                    failures === 2
                      ? [
                          {
                            summary: "Short",
                            path: "src/a.ts",
                            line: 1,
                            excerpt: "source",
                          },
                        ]
                      : [],
                  resolutions: [],
                  summary: "No verified defects in this synthetic patch.",
                  isDegraded: false,
                  outputLimitations: [],
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
        };
      },
    });
    const agent = await getAgentByName(env.REVIEW_AGENTS, `${runId}:0`);
    const id = await runInDurableObject(
      agent,
      async (instance: ReviewAgent) => {
        vi.spyOn(instance, "getModel").mockReturnValue(model);
        return instance.startReview({
          deadlineAt: Date.now() + 60_000,
          phase: "investigation",
          prKey,
          prompt: "Review a synthetic patch.",
          runId,
          shardIndex: 0,
          totalShards: 1,
        });
      },
    );
    const workflow = await env.REVIEW_SHARD_WORKFLOW.get(id);
    let status = await workflow.status();
    for (
      let attempt = 0;
      attempt < 400 &&
      status.status !== "complete" &&
      status.status !== "errored";
      attempt++
    ) {
      await scheduler.wait(25);
      status = await workflow.status();
    }
    if (failures === 2) {
      expect(status.status).toBe("complete");
      expect(status.output).toMatchObject({
        output: {
          findings: [],
          investigations: [],
          isDegraded: true,
          outputLimitations: ["investigation_rejected"],
        },
        evidence: [],
      });
    } else {
      expect(status.status).toBe("errored");
      expect(await agent.getReviewFailure()).toBe("evidence_collection_failed");
    }
    expect(await executor.evidenceReadAttempts(runId)).toBe(3);
    expect(generations).toBe(1);
    await expect(
      agent.sendWorkflowEvent("REVIEW_SHARD_WORKFLOW", id, {
        type: "think-result",
        payload: { late: true },
      }),
    ).resolves.toBeUndefined();
  },
  20_000,
);
