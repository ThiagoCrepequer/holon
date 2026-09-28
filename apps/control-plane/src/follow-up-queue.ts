import { followUpMessageSchema, type FollowUpMessage } from "@holon/contracts";

import { enrichReviewWithCiEvidence } from "./ci-enrichment-service.js";
import {
  handleFeedbackCommentWebhook,
  handleThreadResolvedWebhook,
} from "./feedback-handler-service.js";
import type { QueueMessagePort } from "./queue-consumer.js";
export async function processFollowUp(
  env: Cloudflare.Env,
  message: FollowUpMessage,
): Promise<void> {
  switch (message.event) {
    case "ci_enrichment":
      await enrichReviewWithCiEvidence(env, message.payload);
      return;
    case "feedback_comment":
      await handleFeedbackCommentWebhook(env, message.payload);
      return;
    case "feedback_thread":
      await handleThreadResolvedWebhook(env, message.payload);
      return;
  }
}
export async function dispatchFollowUpMessages(
  messages: readonly QueueMessagePort[],
  process: (message: FollowUpMessage) => Promise<void>,
): Promise<void> {
  // Bound memory while inflating CI artifacts; review model shards use a separate concurrency budget.
  for (const message of messages) {
    const parsed = followUpMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      message.ack();
      continue;
    }
    try {
      await process(parsed.data);
      message.ack();
    } catch {
      message.retry();
    }
  }
}
