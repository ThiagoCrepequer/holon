import { describe, expect, it, vi } from "vitest";

import { dispatchFollowUpMessages } from "../src/follow-up-queue.js";
describe("durable follow-up dispatch", () => {
  it("acknowledges completed work and retries infrastructure failures", async () => {
    const payload = {
      action: "resolved",
      authorLogin: "reviewer",
      deliveryId: "github:feedback-delivery",
      installationId: 99,
      pullRequestNumber: 7,
      repository: { fullName: "acme/api", id: 42, name: "api", owner: "acme" },
      rootCommentId: 123,
    };
    const good = {
      body: { event: "feedback_thread", payload },
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
