import { describe, expect, it, vi } from "vitest";

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
  pullRequest: {
    baseSha: "b".repeat(40),
    headSha: "a".repeat(40),
    number: 7,
    updatedAt: "2026-08-29T12:00:00.000Z",
  },
  receivedAt: "2026-08-29T12:00:00.000Z",
  repository: { fullName: "acme/api", id: 42, name: "api", owner: "acme" },
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
      createBatch: (batch) => Promise.resolve(jobs.push(...batch)),
      get: () => Promise.reject(new Error("unused")),
    });

    expect(queued.state).toEqual({ acked: true, retried: false });
    expect(jobs[0]).toMatchObject({
      id: expect.stringMatching(/^review-[a-f0-9]{64}$/u),
      params: {
        runId: `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}`,
      },
      retention: {
        errorRetention: "3 days",
        successRetention: "1 day",
      },
    });
  });

  it("uses the same workflow id when the queue redelivers the same event", async () => {
    const first = message(envelope);
    const redelivery = message(envelope);
    const batches: unknown[][] = [];
    const workflow = {
      createBatch: (batch: unknown[]) => {
        batches.push(batch);
        return Promise.resolve([]);
      },
      get: () => Promise.reject(new Error("unused")),
    };
    await dispatchReviewMessages([first.value], workflow);
    await dispatchReviewMessages([redelivery.value], workflow);

    expect(batches[0]?.[0]).toEqual(batches[1]?.[0]);
    expect(first.state.acked).toBe(true);
    expect(redelivery.state.acked).toBe(true);
  });

  it("acknowledges poison messages and retries only transient workflow failures", async () => {
    const invalid = message({ invalid: true });
    const transient = message(envelope);
    await dispatchReviewMessages([invalid.value, transient.value], {
      createBatch: () => Promise.reject(new Error("unavailable")),
      get: () => Promise.reject(new Error("not found")),
    });

    expect(invalid.state).toEqual({ acked: true, retried: false });
    expect(transient.state.retried).toBe(true);
  });

  it("groups duplicate messages in one idempotent batch entry", async () => {
    const first = message(envelope);
    const duplicate = message(envelope);
    const createBatch = vi.fn((_batch: readonly unknown[]) =>
      Promise.resolve([]),
    );

    await dispatchReviewMessages([first.value, duplicate.value], {
      createBatch,
      get: () => Promise.reject(new Error("unused")),
    });

    expect(createBatch).toHaveBeenCalledTimes(1);
    expect(createBatch.mock.calls[0]?.[0]).toHaveLength(1);
    expect(first.state).toEqual({ acked: true, retried: false });
    expect(duplicate.state).toEqual({ acked: true, retried: false });
  });

  it("isolates an existing workflow from an unconfirmed failure in a mixed batch", async () => {
    const existing = message(envelope);
    const unavailable = message({
      ...envelope,
      deliveryId: "github:delivery-456",
      pullRequest: { ...envelope.pullRequest, headSha: "c".repeat(40) },
    });
    let existingId = "";
    const createBatch = vi.fn((batch: readonly { readonly id: string }[]) => {
      if (batch.length === 2) {
        existingId = batch[0]!.id;
      }
      return Promise.reject(new Error("ambiguous dispatch failure"));
    });

    await dispatchReviewMessages([existing.value, unavailable.value], {
      createBatch,
      get: (id) =>
        id === existingId
          ? Promise.resolve({
              status: () => Promise.resolve({ status: "unknown" }),
            })
          : Promise.reject(new Error("not found")),
    });

    expect(existing.state).toEqual({ acked: true, retried: false });
    expect(unavailable.state).toEqual({ acked: false, retried: true });
    expect(createBatch).toHaveBeenCalledTimes(2);
  });

  it("acknowledges when singleton creation committed before rejecting", async () => {
    const queued = message(envelope);
    let lookups = 0;
    await dispatchReviewMessages([queued.value], {
      createBatch: () => Promise.reject(new Error("response lost")),
      get: () => {
        lookups += 1;
        return lookups === 1
          ? Promise.reject(new Error("not visible yet"))
          : Promise.resolve({
              status: () => Promise.resolve({ status: "queued" }),
            });
      },
    });

    expect(queued.state).toEqual({ acked: true, retried: false });
    expect(lookups).toBe(2);
  });

  it("routes the Worker queue handler through the validated dispatcher", async () => {
    const queued = message(envelope);
    const jobs: unknown[] = [];
    await worker.queue(
      { messages: [queued.value] } as unknown as MessageBatch,
      {
        REVIEW_WORKFLOW: {
          createBatch: (batch: unknown[]) =>
            Promise.resolve(jobs.push(...batch)),
          get: () => Promise.reject(new Error("unused")),
        },
      } as unknown as Cloudflare.Env,
    );
    expect(queued.state.acked).toBe(true);
    expect(jobs).toHaveLength(1);
  });
});
