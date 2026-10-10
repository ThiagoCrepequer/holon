import {
  aggregateShardReviews,
  verifyFindingsWithCanonicalEvidence,
  applyCausalVerification,
} from "@holon/application";
import {
  createReviewEvidenceReceipt,
  modelReviewOutputSchema,
  type ReviewPlan,
} from "@holon/contracts";
import { type RunId } from "@holon/domain";
import { getAgentByName } from "agents";
import { MockLanguageModelV4 } from "ai/test";
import { reset, runInDurableObject, evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";

import { publishReviewAuthorized } from "../src/review/authorized-publication.js";
import { reviewAgentResultSchema } from "../src/review/review-agent-result.js";
import type { ReviewAgent } from "../src/review/review-agent.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});
const prKey = "github:42:pr:7";
const runId = `${prKey}:head:${"a".repeat(40)}:base:${"b".repeat(40)}` as RunId;
const finding = {
  confidence: 0.95,
  diagnostic:
    "Returning null breaks the caller when it accesses the result without a guard.",
  evidence: [
    {
      path: "src/result.ts",
      startLine: 1,
      excerpt: "return null;",
      reason: "The reachable branch now returns null.",
    },
  ],
  location: { path: "src/result.ts", line: 1, side: "RIGHT" as const },
  severity: "high" as const,
};
const content = "if (value !== null) return value.id;";
function controlledModel(final: unknown) {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          const call =
            step++ === 0
              ? {
                  toolName: "read_file",
                  input: JSON.stringify({
                    path: "src/caller.ts",
                    startLine: 1,
                    endLine: 1,
                  }),
                }
              : {
                  toolName: "think_final_answer",
                  input: JSON.stringify(final),
                };
          controller.enqueue({
            type: "tool-call",
            toolCallId: `tool-${step}`,
            ...call,
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
}
it("runs Think through durable model/tool budgets, real host reads, evidence and publication without publishing a refuted defect", async () => {
  const ledger = env.REVIEW_LEDGERS.getByName(prKey);
  const now = new Date().toISOString();
  await ledger.claimRun(
    {
      id: runId,
      prKey,
      state: "queued",
      attempt: 0,
      causalVersion: now,
      createdAt: now,
    },
    "vertical",
  );
  await ledger.transition(runId, "queued", "running", now, "vertical:start");
  const receipt = await createReviewEvidenceReceipt(
    runId,
    "src/caller.ts",
    1,
    1,
    content,
    false,
  );
  const draft = {
    findings: [
      {
        ...finding,
        suggestion: null,
        location: { ...finding.location, startLine: null },
        evidence: finding.evidence.map((item) => ({ ...item, endLine: null })),
      },
    ],
    summary: "Candidate null dereference.",
    isDegraded: false,
    outputLimitations: [],
    resolutions: [],
    investigations: [],
  };
  const verified = {
    assessments: [
      {
        candidateIndex: 0,
        basis: "repository",
        evidenceReceiptIds: [receipt.id],
        outcome: "refuted",
        confidence: 0.99,
        rationale:
          "The inspected caller positively checks for null before accessing the result's id.",
      },
    ],
    summary: "The caller handles the changed return value.",
  };
  const outputs = [];
  for (const [phase, final] of [
    ["investigation", draft],
    ["causal_verification", verified],
  ] as const) {
    const agent = await getAgentByName(
      env.REVIEW_AGENTS,
      `${runId}:vertical:${phase}`,
    );
    const model = controlledModel(final);
    const workflowId = await runInDurableObject(
      agent,
      async (instance: ReviewAgent) => {
        vi.spyOn(instance, "getProviderModel").mockReturnValue(model);
        return instance.startReview({
          runId,
          prKey,
          phase,
          prompt:
            "Inspect the caller before assessing this null-return candidate.",
          shardIndex: 0,
          totalShards: 1,
          deadlineAt: Date.now() + 60_000,
        });
      },
    );
    const workflow = await env.REVIEW_SHARD_WORKFLOW.get(workflowId);
    await expect
      .poll(async () => (await workflow.status()).status, {
        timeout: 10_000,
        interval: 50,
      })
      .toBe("complete");
    const result = reviewAgentResultSchema.parse(
      (await workflow.status()).output,
    );
    expect(result.evidence).toEqual([{ receipt, content }]);
    outputs.push(result);
    expect(model.doStreamCalls).toHaveLength(2);
    await evictDurableObject(agent);
  }
  const plan: ReviewPlan = {
    shards: [
      {
        id: "shard-0",
        index: 0,
        totalShards: 1,
        byteLength: 26,
        files: [
          {
            path: "src/result.ts",
            mode: "structural",
            patch: "@@ -0,0 +1 @@\n+return null;",
          },
        ],
        changedLines: [{ path: "src/result.ts", line: 1, side: "RIGHT" }],
      },
    ],
    scopeStatus: "complete",
    omissionReasons: [],
    totalEligibleBytes: 26,
    totalEligibleFiles: 1,
    totalEligibleLines: 1,
    unsupportedFilesCount: 0,
  };
  const actualDraft = modelReviewOutputSchema.parse(outputs[0]?.output);
  expect(actualDraft.findings).toEqual([finding]);
  expect(
    verifyFindingsWithCanonicalEvidence(actualDraft.findings, {
      ...plan.shards[0]!,
      truncated: false,
    }).findings,
  ).toHaveLength(1);
  const output = applyCausalVerification(
    actualDraft,
    outputs[1]?.output,
    "en",
    outputs[1]!.evidence.map((item) => item.receipt),
  );
  const aggregated = aggregateShardReviews(plan, [
    { shardId: "shard-0", shardIndex: 0, status: "success", ...output },
  ]);
  expect(aggregated.findings).toHaveLength(0);
  expect(aggregated.verdict).toBe("APPROVE");
  await runInDurableObject(ledger, (_object, state) => {
    expect(
      state.storage.sql
        .exec(
          "SELECT COUNT(*) AS count FROM model_generation_reservations WHERE run_id=?",
          runId,
        )
        .one().count,
    ).toBe(4);
    expect(
      state.storage.sql
        .exec(
          "SELECT SUM(calls) AS count FROM review_tool_budgets WHERE run_id=?",
          runId,
        )
        .one().count,
    ).toBe(2);
  });
  const publish = vi.fn(async () => 321);
  const publicationLedger = {
    authorizeMutation: (id: RunId, purpose: "review" | "failure") =>
      ledger.authorizeMutation(id, purpose),
    claimPublication: (record: import("@holon/domain").PublicationRecord) =>
      ledger.claimPublication(record),
    completePublication: (
      id: import("@holon/domain").PublicationId,
      commentId: number,
    ) => ledger.completePublication(id, commentId),
    checkRunId: () => undefined,
    recordCheckRunId: () => undefined,
    claimRun: (run: import("@holon/domain").ReviewRun, id: string) =>
      ledger.claimRun(run, id),
    isLatestRun: (id: RunId) => ledger.isLatestRun(id),
    transition: (...args: Parameters<typeof ledger.transition>) =>
      ledger.transition(...args),
  };
  await ledger.transition(
    runId,
    "running",
    "publishing",
    now,
    "vertical:publishing",
  );
  await publishReviewAuthorized(
    publicationLedger,
    { findCommentByMarker: async () => ({ status: "absent" }), publish },
    runId,
    aggregated.summary,
    "APPROVE",
    [],
    async () => true,
  );
  expect(publish).toHaveBeenCalledOnce();
  expect(JSON.stringify(publish.mock.calls)).not.toContain(
    "Candidate null dereference",
  );
}, 15_000);
