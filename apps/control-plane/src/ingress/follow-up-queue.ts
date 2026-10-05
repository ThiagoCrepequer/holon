import { followUpMessageSchema, type FollowUpMessage } from "@holon/contracts";

import { handleFindingQuestionWebhook } from "../clarification/finding-question-handler.js";
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
    case "feedback_comment":
      if (await handleFindingQuestionWebhook(env, message.payload)) return;
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
  // Queue messages are processed sequentially to preserve bounded memory use.
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
