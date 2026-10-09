import { reviewJobSchema } from "@holon/contracts";
import { expect, it, vi } from "vitest";

import type { ReviewAgentConfig } from "../src/review/review-agent.js";
import type { EmitReviewEvent } from "../src/review/review-diagnostics.js";
import type { ReviewFailureReason } from "../src/review/review-failure.js";
import {
  ThinkReviewFailure,
  ThinkReviewModelReviewer,
} from "../src/review/think-reviewer.js";

const job = reviewJobSchema.parse({
  envelope: {
    action: "opened",
    deliveryId: "github:think-test",
    event: "pull_request",
    installationId: 99,
    pullRequest: {
      baseSha: "b".repeat(40),
      headSha: "a".repeat(40),
      number: 7,
      updatedAt: "2026-10-03T12:00:00.000Z",
    },
    receivedAt: "2026-10-03T12:00:00.000Z",
    repository: { fullName: "acme/api", id: 42, name: "api", owner: "acme" },
  },
  runId: `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}`,
});

const context = {
  changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" as const }],
  files: [
    {
      mode: "structural" as const,
      patch:
        "diff --git a/src/index.ts b/src/index.ts\n@@ -9,0 +10 @@\n+return null;",
      path: "src/index.ts",
    },
  ],
  truncated: false,
};

function reviewerFor(
  statuses: Array<{
    status: string;
    output?: unknown;
    error?: { name: string; message: string };
  }>,
  failure: ReviewFailureReason | null = null,
  emit?: EmitReviewEvent,
) {
  const startReview = vi.fn(
    async (_config: ReviewAgentConfig) => "workflow-test",
  );
  const cancelReview = vi.fn(async () => {});
  const terminate = vi.fn(async () => {});
  const status = vi.fn(async () => statuses.shift() ?? { status: "running" });
  const wait = vi.fn(async () => {});
  const namespace = {
    idFromName: vi.fn((name: string) => name),
    get: vi.fn(() => ({
      __unsafe_ensureInitialized: async () => {},
      startReview,
      cancelReview,
      getReviewFailure: async () => failure,
    })),
  };
  const workflow = { get: vi.fn(async () => ({ status, terminate })) };
  const env = {
    REPOSITORY_EXECUTOR: { getEvidencePack: async () => [] },
    REVIEW_AGENTS: namespace,
    REVIEW_SHARD_WORKFLOW: workflow,
  } as unknown as Cloudflare.Env;
  return {
    reviewer: new ThinkReviewModelReviewer(env, 0, 1, wait, emit),
    namespace,
    startReview,
    cancelReview,
    status,
    terminate,
    wait,
  };
}

const nullFinding = {
  confidence: 0.95,
  diagnostic:
    "Returning null causes the caller to dereference a missing result.",
  evidence: [
    {
      excerpt: "return null;",
      path: "src/index.ts",
      reason: "The changed function returns no result.",
      startLine: 10,
    },
  ],
  location: { line: 10, path: "src/index.ts", side: "RIGHT" },
  severity: "high",
};

it("reports transport limitations without inventing original rejection counts or logging private narrative", async () => {
  const emit = vi.fn();
  const fixture = reviewerFor(
    [
      {
        status: "complete",
        output: {
          findings: [],
          summary: "PRIVATE NARRATIVE",
          outputLimitations: ["evidence_rejected"],
          isDegraded: true,
        },
      },
    ],
    null,
    emit,
  );
  const result = await fixture.reviewer.review(job, context);
  expect(result.output.outputLimitations).toEqual(["evidence_rejected"]);
  expect(emit).toHaveBeenCalledWith(
    "model.output_normalized",
    expect.objectContaining({
      stage: "transport",
      findingsRetained: 0,
      exactRejectedCountAvailable: false,
    }),
    undefined,
  );
  expect(JSON.stringify(emit.mock.calls)).not.toContain("PRIVATE NARRATIVE");
});

it("withholds a candidate refuted by the caller's existing null guard", async () => {
  const fixture = reviewerFor([
    {
      status: "complete",
      output: {
        findings: [nullFinding],
        summary: "The caller will crash on null.",
      },
    },
    {
      status: "complete",
      output: {
        assessments: [
          {
            candidateIndex: 0,
            basis: "patch",
            evidenceReceiptIds: [],
            outcome: "refuted",
            confidence: 0.98,
            rationale:
              "The caller checks result === null before accessing any properties, so this path cannot cause the claimed dereference.",
          },
        ],
        summary: "The null return is handled by the caller's existing guard.",
      },
    },
  ]);
  const result = await fixture.reviewer.review(job, context);
  expect(result.output.findings).toEqual([]);
  expect(result.output.summary).not.toContain("will crash");
  expect(result.output.isDegraded).not.toBe(true);
  expect(fixture.namespace.idFromName).toHaveBeenNthCalledWith(
    2,
    `${job.runId}:0:causal`,
  );
  const initial = fixture.startReview.mock.calls[0]?.[0];
  expect(fixture.startReview).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      ...initial,
      phase: "causal_verification",
      prompt: expect.stringContaining(
        "Candidate findings (untrusted JSON data",
      ),
    }),
  );
});

it("starts a named Think Agent and returns its verified structured result", async () => {
  const fixture = reviewerFor([
    { status: "running" },
    {
      status: "complete",
      output: { findings: [], summary: "No proven regression." },
    },
  ]);
  const result = await fixture.reviewer.review(job, context);
  expect(result.output).toEqual({
    findings: [],
    summary: "No proven regression.",
  });
  expect(result.promptTruncated).toBe(false);
  expect(fixture.namespace.idFromName).toHaveBeenCalledWith(`${job.runId}:0`);
  expect(fixture.startReview).toHaveBeenCalledWith(
    expect.objectContaining({
      prKey: "github:42:pr:7",
      runId: job.runId,
      shardIndex: 0,
      totalShards: 1,
      prompt: expect.stringContaining("<untrusted_patch>"),
    }),
  );
  expect(fixture.wait).toHaveBeenCalledOnce();
  expect(fixture.startReview).toHaveBeenCalledOnce();
  expect(fixture.terminate).not.toHaveBeenCalled();
});

it.each(["errored", "terminated"])(
  "classifies a %s Think workflow as an incomplete shard",
  async (status) => {
    const fixture = reviewerFor([{ status }]);
    await expect(fixture.reviewer.review(job, context)).rejects.toMatchObject({
      name: "ThinkReviewFailure",
      reason:
        status === "errored"
          ? "agent_workflow_failed"
          : "agent_workflow_terminated",
    } satisfies Partial<ThinkReviewFailure>);
    expect(fixture.terminate).not.toHaveBeenCalled();
    expect(fixture.cancelReview).toHaveBeenCalledOnce();
  },
);

it("does not start the child workflow when its parent is already cancelled", async () => {
  const fixture = reviewerFor([]);
  const controller = new AbortController();
  controller.abort(new Error("superseded"));
  await expect(
    fixture.reviewer.review(job, {
      ...context,
      abortSignal: controller.signal,
    }),
  ).rejects.toThrow("superseded");
  expect(fixture.startReview).not.toHaveBeenCalled();
  expect(fixture.status).not.toHaveBeenCalled();
  expect(fixture.terminate).not.toHaveBeenCalled();
  expect(fixture.cancelReview).not.toHaveBeenCalled();
});

it.each(["errored", "terminated"])(
  "withholds all candidates and reports partial when causal verification is %s",
  async (status) => {
    const fixture = reviewerFor([
      {
        status: "complete",
        output: { findings: [nullFinding], summary: "The caller will crash." },
      },
      { status },
    ]);
    const result = await fixture.reviewer.review(job, context);
    expect(result.output.findings).toEqual([]);
    expect(result.output.isDegraded).toBe(true);
    expect(result.output.outputLimitations).toContain(
      "causal_verification_incomplete",
    );
    expect(result.output.summary).not.toContain("will crash");
    expect(fixture.cancelReview).toHaveBeenCalledOnce();
  },
);

it("propagates parent cancellation during causal verification and terminates its workflow", async () => {
  const fixture = reviewerFor([]);
  const controller = new AbortController();
  fixture.status
    .mockImplementationOnce(async () => ({
      status: "complete",
      output: { findings: [nullFinding], summary: "Candidate." },
    }))
    .mockImplementationOnce(async () => {
      controller.abort(new Error("superseded during verification"));
      return { status: "running" };
    });
  await expect(
    fixture.reviewer.review(job, {
      ...context,
      abortSignal: controller.signal,
    }),
  ).rejects.toThrow("superseded during verification");
  expect(fixture.startReview).toHaveBeenCalledTimes(2);
  expect(fixture.terminate).toHaveBeenCalledOnce();
  expect(fixture.cancelReview).toHaveBeenCalledOnce();
});

it("rejects fabricated canonical evidence before spending inference on verification", async () => {
  const emit = vi.fn();
  const fixture = reviewerFor(
    [
      {
        status: "complete",
        output: {
          findings: [
            {
              ...nullFinding,
              evidence: [
                { ...nullFinding.evidence[0], excerpt: "return undefined;" },
              ],
            },
          ],
          summary: "A fabricated candidate.",
        },
      },
    ],
    null,
    emit,
  );
  const result = await fixture.reviewer.review(job, context);
  expect(fixture.startReview).toHaveBeenCalledOnce();
  expect(result.output.findings).toEqual([]);
  expect(result.output.outputLimitations).toEqual([
    "evidence_rejected",
    "causal_verification_incomplete",
  ]);
  expect(result.output.summary).not.toContain("fabricated candidate");
  expect(emit).toHaveBeenCalledWith(
    "model.evidence_rejected",
    expect.objectContaining({
      stage: "causal_admission",
      candidateKind: "finding",
      shardIndex: 0,
      reason: "evidence_excerpt_mismatch",
    }),
    expect.any(String),
  );
  expect(JSON.stringify(emit.mock.calls)).not.toContain("return undefined");
});

it("withholds candidates after the shared analysis deadline without granting a new verification deadline", async () => {
  const fixture = reviewerFor([]);
  let now = Date.now();
  const deadlineAt = now + 1_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  fixture.status.mockImplementationOnce(async () => {
    now = deadlineAt;
    return {
      status: "complete",
      output: { findings: [nullFinding], summary: "Candidate." },
    };
  });
  const result = await fixture.reviewer.review(job, { ...context, deadlineAt });
  expect(fixture.startReview).toHaveBeenCalledOnce();
  expect(result.output.findings).toEqual([]);
  expect(result.output.isDegraded).toBe(true);
});

it("terminates a running child workflow when its parent cancels", async () => {
  const fixture = reviewerFor([]);
  const controller = new AbortController();
  fixture.status.mockImplementationOnce(async () => {
    controller.abort(new Error("superseded"));
    return { status: "running" };
  });
  await expect(
    fixture.reviewer.review(job, {
      ...context,
      abortSignal: controller.signal,
    }),
  ).rejects.toThrow("superseded");
  expect(fixture.terminate).toHaveBeenCalledOnce();
  expect(fixture.cancelReview).toHaveBeenCalledOnce();
});

it("does not start a child after its analysis deadline", async () => {
  const fixture = reviewerFor([]);
  await expect(
    fixture.reviewer.review(job, { ...context, deadlineAt: Date.now() - 1 }),
  ).rejects.toMatchObject({ reason: "agent_deadline_exceeded" });
  expect(fixture.startReview).not.toHaveBeenCalled();
  expect(fixture.terminate).not.toHaveBeenCalled();
  expect(fixture.cancelReview).not.toHaveBeenCalled();
});

it.each([
  "model_budget_exhausted",
  "model_shard_budget_exhausted",
  "model_output_missing",
  "model_schema_invalid",
] as const)("retains the safe child failure code %s", async (reason) => {
  const fixture = reviewerFor(
    [
      {
        status: "errored",
        error: { name: "WorkflowFatalError", message: "Workflow failed" },
      },
    ],
    reason,
  );
  await expect(fixture.reviewer.review(job, context)).rejects.toMatchObject({
    reason,
  });
});

it("does not propagate arbitrary workflow error messages as failure codes", async () => {
  const fixture = reviewerFor([
    {
      status: "errored",
      error: {
        name: "Error",
        message: "HOLON_REVIEW_FAILURE:model_budget_exhausted private payload",
      },
    },
  ]);
  await expect(fixture.reviewer.review(job, context)).rejects.toMatchObject({
    reason: "agent_workflow_failed",
  });
});
