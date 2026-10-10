import { expect, it, vi } from "vitest";

import { ReviewAgent } from "../src/review/review-agent.js";

it.each(["complete", "errored", "terminated", "running", "waiting"])(
  "delivers notifications only while a shard can receive them: %s",
  async (status) => {
    const sendEvent = vi.fn(async () => {});
    const agent = Object.assign(Object.create(ReviewAgent.prototype), {
      env: {
        REVIEW_SHARD_WORKFLOW: {
          create: vi.fn(),
          get: async () => ({ status: async () => ({ status }), sendEvent }),
        },
      },
      _emit: vi.fn(),
    }) as ReviewAgent;
    await agent.sendWorkflowEvent("REVIEW_SHARD_WORKFLOW", "synthetic-shard", {
      type: "think-result",
      payload: {},
    });
    expect(sendEvent).toHaveBeenCalledTimes(
      status === "running" || status === "waiting" ? 1 : 0,
    );
  },
);

it("does not discard a notification when the workflow status cannot be read", async () => {
  const sendEvent = vi.fn(async () => {});
  const agent = Object.assign(Object.create(ReviewAgent.prototype), {
    env: {
      REVIEW_SHARD_WORKFLOW: {
        get: async () => ({
          status: async () => {
            throw new Error("synthetic status outage");
          },
          sendEvent,
        }),
      },
    },
  }) as ReviewAgent;
  await expect(
    agent.sendWorkflowEvent("REVIEW_SHARD_WORKFLOW", "synthetic-shard", {
      type: "think-result",
      payload: {},
    }),
  ).rejects.toThrow("synthetic status outage");
  expect(sendEvent).not.toHaveBeenCalled();
});
