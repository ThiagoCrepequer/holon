import { parseModelReviewTransport } from "@holon/contracts";
import type { ReviewRun, RunId } from "@holon/domain";
import { withGenerationBudget } from "@holon/model";
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

const prKey = "github:42:pr:7";
const baseRunId =
  `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}` as RunId;
const run: ReviewRun = {
  attempt: 0,
  causalVersion: "2026-10-04T12:00:00.000Z",
  createdAt: "2026-10-04T12:00:00.000Z",
  id: baseRunId,
  prKey,
  state: "queued",
};
const finding = {
  confidence: 0.9,
  diagnostic: "Removing this guard permits an unauthorized write.",
  evidence: [
    {
      endLine: null,
      excerpt: "write()",
      path: "src/a.ts",
      reason: "The authorization guard was removed.",
      startLine: 10,
    },
  ],
  location: { line: 10, path: "src/a.ts", side: "RIGHT", startLine: null },
  severity: "high",
  suggestion: null,
};
const scenarios = [
  "recovered",
  "still_blank",
  "provider_error",
  "already_degraded",
  "prior_limitation",
  "recovery_degraded",
  "recovery_limitation",
  "budget_denied",
  "replacement_attempt",
  "obsolete",
] as const;

it.each(scenarios)(
  "recovers only the narrative within the durable run budget: %s",
  async (scenario) => {
    // Workflows keep deterministic IDs across DO resets; use a distinct run per scenario.
    const runId =
      `github:42:pr:7:head:${(scenarios.indexOf(scenario) + 1).toString(16).padStart(40, "a")}:base:${"b".repeat(40)}` as RunId;
    const ledger = env.REVIEW_LEDGERS.getByName(prKey);
    await ledger.claimRun({ ...run, id: runId }, "summary-recovery-test");
    await ledger.transition(
      runId,
      "queued",
      "running",
      new Date().toISOString(),
      "summary-recovery-test:start",
    );
    const shardIndex = 0;
    const initial = {
      findings:
        scenario === "recovered" || scenario === "budget_denied"
          ? []
          : [finding],
      investigations: [
        {
          summary: "The authorization guard protects writes in this module.",
          path: "src/a.ts",
          line: 10,
          excerpt: "write()",
        },
      ],
      resolutions: [
        {
          confidence: finding.confidence,
          diagnostic: finding.diagnostic,
          evidence: finding.evidence,
          location: finding.location,
          fingerprint: `fp:${"a".repeat(64)}`,
        },
      ],
      summary: "",
      isDegraded: scenario === "already_degraded",
      outputLimitations:
        scenario === "prior_limitation" ? ["input_context_omitted"] : [],
    };
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async (options) => {
        const first = calls++ === 0;
        if (first && scenario === "budget_denied") {
          for (let i = 0; i < 63; i++) {
            const admission = await env.REVIEW_LEDGERS.getByName(
              prKey,
            ).reserveModelGeneration(runId, {
              phase: "investigation",
              inputBytes: 1,
              outputTokens: 1,
              shardIndex,
              shardCount: 1,
            });
            expect(admission?.accepted).toBe(true);
          }
        }
        if (!first) {
          expect(options.maxOutputTokens).toBe(1_024);
          expect(options.tools?.map((tool) => tool.name)).toEqual([
            "think_final_answer",
          ]);
          if (scenario === "obsolete") {
            await env.REVIEW_LEDGERS.getByName(prKey).transition(
              runId,
              "running",
              "obsolete",
              new Date().toISOString(),
              "summary-recovery-test:obsolete",
            );
            throw new Error("Provider result unavailable after supersession");
          }
          if (scenario === "provider_error")
            throw new Error("Synthetic provider failure");
        }
        const recovered = {
          summary:
            scenario === "still_blank"
              ? "   "
              : "The analyzed changes contain no additional verified regressions.",
          isDegraded: scenario === "recovery_degraded",
          outputLimitations:
            scenario === "recovery_limitation"
              ? ["investigation_incomplete"]
              : [],
          ...(scenario === "replacement_attempt" ? { findings: [] } : {}),
        };
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({
                type: "tool-call",
                toolCallId: `final-${calls}`,
                toolName: "think_final_answer",
                input: JSON.stringify(first ? initial : recovered),
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
    const agent = await getAgentByName(
      env.REVIEW_AGENTS,
      `${runId}:${shardIndex}`,
    );
    const config = {
      deadlineAt: Date.now() + 30_000,
      phase: "investigation" as const,
      prKey,
      prompt: "Review the authorization guard in src/a.ts.",
      runId,
      shardIndex,
      totalShards: 1,
    };
    const workflowId = await runInDurableObject(
      agent,
      async (instance: ReviewAgent) => {
        vi.spyOn(instance, "getModel").mockReturnValue(
          withGenerationBudget(model, {
            reserve: (request) =>
              env.REVIEW_LEDGERS.getByName(prKey).reserveModelGeneration(
                runId,
                { ...request, shardIndex, shardCount: 1 },
              ),
            settle: (id, outputTokens) =>
              env.REVIEW_LEDGERS.getByName(prKey).settleModelGeneration(
                runId,
                id,
                outputTokens,
              ),
          }),
        );
        return instance.startReview(config);
      },
    );
    const workflow = await env.REVIEW_SHARD_WORKFLOW.get(workflowId);
    let status = await workflow.status();
    for (
      let i = 0;
      i < 200 && status.status !== "complete" && status.status !== "errored";
      i++
    ) {
      await scheduler.wait(25);
      status = await workflow.status();
    }
    if (scenario === "obsolete") {
      expect(status.status).toBe("errored");
    } else {
      expect(status.status).toBe("complete");
      const output = status.output as ReturnType<
        typeof parseModelReviewTransport
      >;
      expect(output.findings).toEqual(
        parseModelReviewTransport(initial).findings,
      );
      expect(output.resolutions).toEqual(
        parseModelReviewTransport(initial).resolutions,
      );
      expect(output.investigations).toEqual(initial.investigations);
      if (
        [
          "still_blank",
          "provider_error",
          "budget_denied",
          "replacement_attempt",
        ].includes(scenario)
      ) {
        expect(output.isDegraded).toBe(true);
        expect(output.outputLimitations).toContain("summary_missing");
      } else {
        expect(output.summary).not.toBe("");
        expect(output.outputLimitations ?? []).not.toContain("summary_missing");
        expect(output.isDegraded).toBe(scenario !== "recovered");
        if (scenario === "prior_limitation")
          expect(output.outputLimitations).toContain("input_context_omitted");
        if (scenario === "recovery_limitation")
          expect(output.outputLimitations).toContain(
            "investigation_incomplete",
          );
      }
    }
    expect(model.doStreamCalls).toHaveLength(
      scenario === "budget_denied" ? 1 : 2,
    );
    await runInDurableObject(ledger, (_instance, state) => {
      const rows = state.storage.sql
        .exec(
          "SELECT COUNT(*) AS calls FROM model_generation_reservations WHERE run_id = ?",
          runId,
        )
        .toArray();
      expect(rows).toEqual([{ calls: scenario === "budget_denied" ? 64 : 2 }]);
    });
    if (scenario === "recovered") {
      expect(await agent.prepareSummaryRecovery()).toBeGreaterThan(0);
      expect(model.doStreamCalls).toHaveLength(2);
      await runInDurableObject(agent, async (instance: ReviewAgent) => {
        const turn = await instance.beforeTurn(
          {} as Parameters<ReviewAgent["beforeTurn"]>[0],
        );
        expect(turn).toMatchObject({
          maxSteps: 1,
          maxOutputTokens: 1_024,
          activeTools: ["think_final_answer"],
        });
        expect(
          await instance.beforeToolCall({ toolName: "read_file" } as Parameters<
            ReviewAgent["beforeToolCall"]
          >[0]),
        ).toMatchObject({ action: "block" });
      });
    }
  },
  20_000,
);
