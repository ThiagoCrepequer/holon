import { reviewJobSchema } from "@holon/contracts";
import type { ReviewRun, RunId } from "@holon/domain";
import { createRepositoryModelTools, withGenerationBudget } from "@holon/model";
import { getAgentByName } from "agents";
import { MockLanguageModelV4 } from "ai/test";
import { reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";

import type { ReviewAgent } from "../src/review-agent.js";
import { ThinkReviewModelReviewer } from "../src/think-reviewer.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

const stream = (toolName: string, input: unknown) => ({
  stream: new ReadableStream({
    start(controller) {
      controller.enqueue({
        type: "tool-call",
        toolCallId: toolName,
        toolName,
        input: JSON.stringify(input),
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
});

it("refutes a draft through an isolated Think workflow after inspecting a guarded caller", async () => {
  const prKey = "github:42:pr:7";
  const runId =
    `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}` as RunId;
  const run: ReviewRun = {
    attempt: 0,
    causalVersion: "2026-10-04T12:00:00.000Z",
    createdAt: "2026-10-04T12:00:00.000Z",
    id: runId,
    prKey,
    state: "queued",
  };
  const ledger = env.REVIEW_LEDGERS.getByName(prKey);
  await ledger.claimRun(run, "causal-integration");
  await ledger.transition(
    runId,
    "queued",
    "running",
    new Date().toISOString(),
    "causal-integration:start",
  );
  const job = reviewJobSchema.parse({
    runId,
    envelope: {
      action: "opened",
      deliveryId: "github:causal-integration",
      event: "pull_request",
      installationId: 99,
      pullRequest: {
        baseSha: "b".repeat(40),
        headSha: "a".repeat(40),
        number: 7,
        updatedAt: run.causalVersion,
      },
      receivedAt: run.createdAt,
      repository: { fullName: "acme/api", id: 42, name: "api", owner: "acme" },
    },
  });
  const initialAnswer = {
    findings: [
      {
        confidence: 0.95,
        diagnostic:
          "Returning null causes the caller to dereference a missing result.",
        evidence: [
          {
            endLine: null,
            excerpt: "return null;",
            path: "src/result.ts",
            reason: "The branch returns no result.",
            startLine: 10,
          },
        ],
        location: {
          line: 10,
          path: "src/result.ts",
          side: "RIGHT",
          startLine: null,
        },
        severity: "high",
        suggestion: null,
      },
    ],
    isDegraded: false,
    outputLimitations: [],
    resolutions: [],
    summary: "The caller will crash.",
  };
  const verificationAnswer = {
    assessments: [
      {
        candidateIndex: 0,
        outcome: "refuted",
        confidence: 0.98,
        rationale:
          "The inspected caller returns early when result === null, before any property access. This guard prevents the claimed dereference.",
      },
    ],
    summary: "The existing caller guard handles the null branch.",
  };
  const investigation = new MockLanguageModelV4({
    doStream: async () => stream("think_final_answer", initialAnswer),
  });
  let verifierTurns = 0;
  const verification = new MockLanguageModelV4({
    doStream: async (options) => {
      const prompt = JSON.stringify(options.prompt);
      expect(prompt).toContain("skeptical causal verifier");
      if (verifierTurns++ === 0) {
        expect(prompt).not.toContain("if (result === null) return;");
        return stream("read_file", { path: "src/caller.ts" });
      }
      expect(prompt).toContain("if (result === null) return;");
      return stream("think_final_answer", verificationAnswer);
    },
  });
  const readCaller = vi.fn(async () => ({
    content:
      "const result = load();\nif (result === null) return;\nconsume(result.value);",
    truncated: false,
  }));
  for (const [phase, model] of [
    ["investigation", investigation],
    ["causal_verification", verification],
  ] as const) {
    const name = `${runId}:0${phase === "causal_verification" ? ":causal" : ""}`;
    const agent = await getAgentByName(env.REVIEW_AGENTS, name);
    await runInDurableObject(agent, async (instance: ReviewAgent) => {
      vi.spyOn(instance, "getModel").mockReturnValue(
        withGenerationBudget(
          model,
          {
            reserve: (request) =>
              env.REVIEW_LEDGERS.getByName(prKey).reserveModelGeneration(
                runId,
                { ...request, shardIndex: 0, shardCount: 1 },
              ),
            settle: (id, outputTokens) =>
              env.REVIEW_LEDGERS.getByName(prKey).settleModelGeneration(
                runId,
                id,
                outputTokens,
              ),
          },
          phase,
        ),
      );
      if (phase === "causal_verification")
        vi.spyOn(instance, "getTools").mockReturnValue(
          createRepositoryModelTools({ run: readCaller }),
        );
    });
  }
  const reviewer = new ThinkReviewModelReviewer(env, 0, 1, () =>
    scheduler.wait(25),
  );
  const result = await reviewer.review(job, {
    changedLines: [{ line: 10, path: "src/result.ts", side: "RIGHT" }],
    files: [
      {
        mode: "structural",
        path: "src/result.ts",
        patch: "@@ -9,0 +10 @@\n+return null;",
      },
    ],
    truncated: false,
    deadlineAt: Date.now() + 10_000,
  });
  expect(result.output.findings).toEqual([]);
  expect(result.output.summary).toEqual(verificationAnswer.summary);
  expect(result.output.isDegraded).not.toBe(true);
  expect(investigation.doStreamCalls).toHaveLength(1);
  expect(verification.doStreamCalls).toHaveLength(2);
  expect(readCaller).toHaveBeenCalledWith(
    { name: "read_file", arguments: { path: "src/caller.ts" } },
    expect.anything(),
  );
  await runInDurableObject(ledger, (_instance, state) => {
    const reservations = state.storage.sql
      .exec(
        "SELECT shard_index, COUNT(*) AS calls, SUM(output_tokens) AS output, SUM(settled) AS settled FROM model_generation_reservations WHERE run_id = ? GROUP BY shard_index",
        runId,
      )
      .toArray();
    expect(reservations).toEqual([
      { shard_index: 0, calls: 3, output: 30, settled: 3 },
    ]);
  });
  const verifier = await getAgentByName(env.REVIEW_AGENTS, `${runId}:0:causal`);
  await runInDurableObject(verifier, async (instance: ReviewAgent) => {
    const turn = await instance.beforeTurn(
      {} as Parameters<ReviewAgent["beforeTurn"]>[0],
    );
    expect(turn.maxSteps).toBe(8);
    expect(
      await instance.beforeToolCall({ toolName: "bash" } as Parameters<
        ReviewAgent["beforeToolCall"]
      >[0]),
    ).toMatchObject({ action: "block" });
  });
}, 15_000);
