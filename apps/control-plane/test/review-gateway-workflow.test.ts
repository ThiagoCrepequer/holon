import type { RunId } from "@holon/domain";
import {
  createGatewayLanguageModel,
  createRepositoryModelTools,
  withGenerationBudget,
} from "@holon/model";
import { getAgentByName } from "agents";
import { evictDurableObject, reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";

import type { ReviewAgent } from "../src/review/review-agent.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

function syntheticStream(
  call: number,
  missingFinal: boolean,
  missingUsage: boolean,
): Response {
  const finalStep = call === 4;
  const input = finalStep
    ? {
        findings: [],
        isDegraded: false,
        outputLimitations: [],
        resolutions: [],
        investigations: [],
        summary: "No verified regressions in the synthetic fixture.",
      }
    : { path: "src/fixture.ts" };
  const noTool = finalStep && missingFinal;
  const event = (choices: unknown[], usage?: unknown) =>
    `data: ${JSON.stringify({ id: `synthetic-${call}`, object: "chat.completion.chunk", created: 1, model: "fixture", choices, ...(usage === undefined ? {} : { usage }) })}\n\n`;
  const body = [
    event([
      {
        index: 0,
        delta: noTool
          ? { content: "Incomplete." }
          : {
              tool_calls: [
                {
                  index: 0,
                  id: `tool-${call}`,
                  type: "function",
                  function: {
                    name: finalStep ? "think_final_answer" : "read_file",
                    arguments: JSON.stringify(input),
                  },
                },
              ],
            },
        finish_reason: null,
      },
    ]),
    event([
      {
        index: 0,
        delta: {},
        finish_reason: noTool ? "stop" : "tool_calls",
      },
    ]),
    missingUsage
      ? ""
      : event([], {
          prompt_tokens: 10,
          completion_tokens: 10,
          total_tokens: 20,
          completion_tokens_details: { reasoning_tokens: 4 },
        }),
    "data: [DONE]\n\n",
  ].join("");
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
}

it.each(["complete", "missing_final", "missing_usage"] as const)(
  "uses the Gateway protocol through the durable Think workflow: %s",
  async (scenario) => {
    const missingFinal = scenario === "missing_final";
    const missingUsage = scenario === "missing_usage";
    const prKey =
      `github:42:pr:${missingFinal ? 9 : missingUsage ? 10 : 8}` as const;
    const runId =
      `${prKey}:head:${"a".repeat(40)}:base:${"b".repeat(40)}` as RunId;
    const requests: unknown[] = [];
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_url, init) => {
        if (typeof init?.body !== "string")
          throw new TypeError("Expected a serialized model request");
        requests.push(JSON.parse(init.body));
        return syntheticStream(requests.length, missingFinal, missingUsage);
      });
    const ledger = env.REVIEW_LEDGERS.getByName(prKey);
    await ledger.claimRun(
      {
        attempt: 0,
        causalVersion: "2026-10-08T12:00:00.000Z",
        createdAt: "2026-10-08T12:00:00.000Z",
        id: runId,
        prKey,
        state: "queued",
      },
      "gateway-protocol-test",
    );
    await ledger.transition(
      runId,
      "queued",
      "running",
      new Date().toISOString(),
      "gateway-protocol-test:start",
    );
    const model = withGenerationBudget(
      createGatewayLanguageModel({
        accountId: "synthetic-account",
        apiToken: "synthetic-token",
        gatewayId: "synthetic-gateway",
        model: "dynamic/pr-review",
      }),
      {
        reserve: (request) =>
          env.REVIEW_LEDGERS.getByName(prKey).reserveModelGeneration(runId, {
            ...request,
            shardIndex: 0,
            shardCount: 1,
          }),
        settle: (id, tokens) =>
          env.REVIEW_LEDGERS.getByName(prKey).settleModelGeneration(
            runId,
            id,
            tokens,
          ),
      },
    );
    const agent = await getAgentByName(
      env.REVIEW_AGENTS,
      `${runId}:gateway:${missingFinal}`,
    );
    const workflowId = await runInDurableObject(
      agent,
      async (instance: ReviewAgent) => {
        vi.spyOn(instance, "getModel").mockReturnValue(model);
        vi.spyOn(instance, "getTools").mockReturnValue(
          createRepositoryModelTools({
            run: async () => ({
              content: "export const fixture = true;",
              truncated: false,
            }),
          }),
        );
        return instance.startReview({
          deadlineAt: Date.now() + 60_000,
          phase: "investigation",
          prKey,
          prompt:
            "Review the synthetic fixture using read_file before concluding.",
          runId,
          shardIndex: 0,
          totalShards: 1,
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
        ? { status: "errored", error: { name: "WorkflowFatalError" } }
        : { status: "complete", output: { findings: [], isDegraded: false } },
    );
    expect(fetcher).toHaveBeenCalledTimes(4);
    for (const request of requests)
      expect(request).toMatchObject({
        stream: true,
        stream_options: { include_usage: true },
        provider: { require_parameters: true },
        reasoning: { enabled: false },
        max_tokens: 12_000,
      });
    expect(requests[3]).toMatchObject({
      tool_choice: {
        type: "function",
        function: { name: "think_final_answer" },
      },
      tools: [
        expect.objectContaining({
          function: expect.objectContaining({ name: "think_final_answer" }),
        }),
      ],
    });
    if (missingFinal) {
      await evictDurableObject(agent);
      expect(await agent.getReviewFailure()).toBe("model_output_missing");
    }
    // Four known completions cost 40 tokens including reasoning; unknown usage
    // retains all four 12,000-token reservations. Admit exactly the remainder.
    const reservation = {
      phase: "finalization" as const,
      inputBytes: 1,
      outputTokens: missingUsage ? 72_000 : 119_960,
      shardIndex: 0,
      shardCount: 1,
    };
    expect(
      await ledger.reserveModelGeneration(runId, reservation),
    ).toMatchObject({ accepted: true });
    expect(
      await ledger.reserveModelGeneration(runId, {
        ...reservation,
        outputTokens: 1,
      }),
    ).toMatchObject({ accepted: false, reason: "output_tokens" });
  },
  15_000,
);
