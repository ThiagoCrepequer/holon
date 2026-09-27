import { consoleErrorReporter, withErrorReporting } from "@holon/observability";

import {
  dispatchFollowUpMessages,
  processFollowUp,
} from "./follow-up-queue.js";
import { dispatchReviewMessages } from "./queue-consumer.js";
import { createWebhookApp } from "./webhook-handler.js";

export { ReviewLedgerObject } from "./ledger-object.js";
export { ReviewWorkflow } from "./review-workflow.js";
export { GitHubCredentialBrokerEntrypoint } from "./credential-broker.js";
export { AdminReadEntrypoint } from "./admin-read-entrypoint.js";

const app = createWebhookApp();

export default {
  async fetch(
    request: Request,
    env: Cloudflare.Env,
    context: ExecutionContext,
  ): Promise<Response> {
    return await withErrorReporting(
      "worker.fetch_failed",
      consoleErrorReporter,
      { component: "control-plane", operation: "http.fetch" },
      async () => await app.fetch(request, env, context),
    );
  },
  async queue(batch: MessageBatch, env: Cloudflare.Env): Promise<void> {
    await withErrorReporting(
      "worker.queue_failed",
      consoleErrorReporter,
      {
        component: "control-plane",
        operation: "queue.dispatch",
        batchSize: batch.messages.length,
      },
      async () => {
        const reviewMessages = batch.messages.filter(
          (message) =>
            typeof message.body === "object" &&
            message.body !== null &&
            "event" in message.body &&
            message.body.event === "pull_request",
        );
        const followUps = batch.messages.filter(
          (message) => !reviewMessages.includes(message),
        );
        await Promise.all([
          dispatchReviewMessages(reviewMessages, env.REVIEW_WORKFLOW),
          dispatchFollowUpMessages(followUps, (message) =>
            processFollowUp(env, message),
          ),
        ]);
      },
    );
  },
} satisfies ExportedHandler<Cloudflare.Env>;

export { ProjectIdentificationCacheObject } from "./project-identification-cache.js";
export { ProjectIdentificationRegistryObject } from "./project-identification-registry.js";
