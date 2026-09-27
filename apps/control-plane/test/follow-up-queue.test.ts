import { describe, expect, it, vi } from "vitest";

import { dispatchFollowUpMessages } from "../src/follow-up-queue.js";
describe("durable follow-up dispatch", () => {
  it("acknowledges completed work and retries infrastructure failures", async () => {
    const payload = {
      deliveryId: "github:ci-delivery",
      headSha: "a".repeat(40),
      installationId: 99,
      pullRequestNumber: 7,
      repository: { id: 42, name: "api", owner: "acme" },
      workflowRunId: 123,
      workflowRunAttempt: 1,
    };
    const good = {
      body: { event: "ci_enrichment", payload },
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const failed = { ...good, ack: vi.fn(), retry: vi.fn() };
    const process = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("network"));
    await dispatchFollowUpMessages([good, failed], process);
    expect(good.ack).toHaveBeenCalledOnce();
    expect(good.retry).not.toHaveBeenCalled();
    expect(failed.retry).toHaveBeenCalledOnce();
    expect(failed.ack).not.toHaveBeenCalled();
  });
  it("rejects malformed payloads without invoking handlers", async () => {
    const message = {
      body: { event: "ci_enrichment", payload: { installationId: -1 } },
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const process = vi.fn();
    await dispatchFollowUpMessages([message], process);
    expect(message.ack).toHaveBeenCalledOnce();
    expect(process).not.toHaveBeenCalled();
  });
});
