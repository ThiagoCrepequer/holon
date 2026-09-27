import { expect, it, vi } from "vitest";

import { enrichReviewWithCiEvidence } from "../src/ci-enrichment-service.js";
import {
  handleFeedbackCommentWebhook,
  handleThreadResolvedWebhook,
} from "../src/feedback-handler-service.js";
import { processFollowUp } from "../src/follow-up-queue.js";
vi.mock("../src/ci-enrichment-service.js", () => ({
  enrichReviewWithCiEvidence: vi.fn(),
}));
vi.mock("../src/feedback-handler-service.js", () => ({
  handleFeedbackCommentWebhook: vi.fn(),
  handleThreadResolvedWebhook: vi.fn(),
}));
it("routes every follow-up to its handler and propagates retryable failures", async () => {
  const env = {} as Cloudflare.Env;
  const base = {
    deliveryId: "github:delivery" as const,
    installationId: 99,
    pullRequestNumber: 7,
    repository: { id: 42, name: "api", owner: "acme", fullName: "acme/api" },
    authorLogin: "alice",
  };
  const comment = {
    ...base,
    action: "created" as const,
    body: "false positive",
    commentId: 1,
    createdAt: "2026-09-27T00:00:00Z",
  };
  const thread = { ...base, action: "resolved" as const, rootCommentId: 1 };
  await processFollowUp(env, { event: "feedback_comment", payload: comment });
  expect(handleFeedbackCommentWebhook).toHaveBeenCalledWith(env, comment);
  await processFollowUp(env, { event: "feedback_thread", payload: thread });
  expect(handleThreadResolvedWebhook).toHaveBeenCalledWith(env, thread);
  const ci = {
    deliveryId: "delivery",
    installationId: 99,
    pullRequestNumber: 7,
    headSha: "a".repeat(40),
    repository: { id: 42, name: "api", owner: "acme" },
    workflowRunId: 1,
    workflowRunAttempt: 1,
  };
  await processFollowUp(env, { event: "ci_enrichment", payload: ci });
  expect(enrichReviewWithCiEvidence).toHaveBeenCalledWith(env, ci);
  vi.mocked(enrichReviewWithCiEvidence).mockRejectedValue(new Error("network"));
  await expect(
    processFollowUp(env, { event: "ci_enrichment", payload: ci }),
  ).rejects.toThrow("network");
});
