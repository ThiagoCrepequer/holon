import { reviewJobSchema } from "@holon/contracts";
import { expect, it, vi } from "vitest";

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

function reviewerFor(statuses: Array<{ status: string; output?: unknown }>) {
  const startReview = vi.fn(async () => "workflow-test");
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
    })),
  };
  const workflow = { get: vi.fn(async () => ({ status, terminate })) };
  const env = {
    REVIEW_AGENTS: namespace,
    REVIEW_SHARD_WORKFLOW: workflow,
  } as unknown as Cloudflare.Env;
  return {
    reviewer: new ThinkReviewModelReviewer(env, 0, 1, wait),
    namespace,
    startReview,
    cancelReview,
    status,
    terminate,
    wait,
  };
}

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
