import { consoleErrorReporter, withErrorReporting } from "@holon/observability";

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
    env: Env,
    context: ExecutionContext,
  ): Promise<Response> {
    return await withErrorReporting(
      "worker.fetch_failed",
      consoleErrorReporter,
      { component: "control-plane", operation: "http.fetch" },
      async () => await app.fetch(request, env, context),
    );
  },
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    await withErrorReporting(
      "worker.queue_failed",
      consoleErrorReporter,
      {
        component: "control-plane",
        operation: "queue.dispatch",
        batchSize: batch.messages.length,
      },
      async () =>
        await dispatchReviewMessages(batch.messages, env.REVIEW_WORKFLOW),
    );
  },
} satisfies ExportedHandler<Env>;

export { ProjectIdentificationCacheObject } from "./project-identification-cache.js";
export { ProjectIdentificationRegistryObject } from "./project-identification-registry.js";
