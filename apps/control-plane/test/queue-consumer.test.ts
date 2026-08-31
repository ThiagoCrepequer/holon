import { describe, expect, it } from "vitest";

import worker from "../src/index.js";
import {
  dispatchReviewMessages,
  type QueueMessagePort,
} from "../src/queue-consumer.js";

const envelope = {
  action: "opened",
  deliveryId: "github:delivery-123",
  event: "pull_request",
  installationId: 99,
  pullRequest: { baseSha: "b".repeat(40), headSha: "a".repeat(40), number: 7 },
  receivedAt: "2026-08-29T12:00:00.000Z",
  repository: { fullName: "acme/api", id: 42, name: "api", owner: "acme" },
  schemaVersion: 1,
};

function message(body: unknown) {
  const state = { acked: false, retried: false };
  const value: QueueMessagePort = {
    ack: () => (state.acked = true),
    body,
    retry: () => (state.retried = true),
  };
  return { state, value };
}

describe("queue consumer", () => {
  it("starts a workflow with the deterministic run identity then acknowledges", async () => {
    const queued = message(envelope);
    const jobs: unknown[] = [];
    await dispatchReviewMessages([queued.value], {
      create: (job) => Promise.resolve(jobs.push(job)),
    });

    expect(queued.state).toEqual({ acked: true, retried: false });
    expect(jobs[0]).toMatchObject({
      params: { runId: `github:42:pr:7:head:${"a".repeat(40)}` },
    });
  });

  it("acknowledges poison messages and retries only transient workflow failures", async () => {
    const invalid = message({ invalid: true });
    const transient = message(envelope);
    await dispatchReviewMessages([invalid.value, transient.value], {
      create: () => Promise.reject(new Error("unavailable")),
    });

    expect(invalid.state).toEqual({ acked: true, retried: false });
    expect(transient.state.retried).toBe(true);
  });

  it("routes the Worker queue handler through the validated dispatcher", async () => {
    const queued = message(envelope);
    const jobs: unknown[] = [];
    await worker.queue(
      { messages: [queued.value] } as unknown as MessageBatch,
      {
        REVIEW_WORKFLOW: {
          create: (job: unknown) => Promise.resolve(jobs.push(job)),
        },
      } as unknown as Cloudflare.Env,
    );
    expect(queued.state.acked).toBe(true);
    expect(jobs).toHaveLength(1);
  });
});
