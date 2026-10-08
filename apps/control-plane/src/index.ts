import { dispatchDashboardAccessMessages } from "./ingress/dashboard-access-events.js";
import {
  dispatchFollowUpMessages,
  processFollowUp,
} from "./ingress/follow-up-queue.js";
import { dispatchReviewMessages } from "./ingress/queue-consumer.js";
import { createWebhookApp } from "./ingress/webhook-handler.js";

export { ReviewLedgerObject } from "./ledger/ledger-object.js";
export { ReviewWorkflow } from "./review/review-workflow.js";
export { ReviewAgent, ReviewShardWorkflow } from "./review/review-agent.js";
export {
  FindingClarificationAgent,
  FindingClarificationWorkflow,
} from "./clarification/finding-clarification-agent.js";
export { GitHubCredentialBrokerEntrypoint } from "./github/credential-broker.js";

const app = createWebhookApp();

export default {
  async fetch(
    request: Request,
    env: Cloudflare.Env,
    context: ExecutionContext,
  ): Promise<Response> {
    return await app.fetch(request, env, context);
  },
  async queue(batch: MessageBatch, env: Cloudflare.Env): Promise<void> {
    const reviewMessages = batch.messages.filter(
      (message) =>
        typeof message.body === "object" &&
        message.body !== null &&
        "event" in message.body &&
        message.body.event === "pull_request",
    );
    const accessEvents = batch.messages.filter(
      (message) =>
        typeof message.body === "object" &&
        message.body !== null &&
        "event" in message.body &&
        message.body.event === "github_access",
    );
    const followUps = batch.messages.filter(
      (message) =>
        !reviewMessages.includes(message) && !accessEvents.includes(message),
    );
    await Promise.all([
      dispatchDashboardAccessMessages(accessEvents, env),
      dispatchReviewMessages(reviewMessages, env.REVIEW_WORKFLOW),
      dispatchFollowUpMessages(followUps, (message) =>
        processFollowUp(env, message),
      ),
    ]);
  },
} satisfies ExportedHandler<Cloudflare.Env>;

export { ProjectIdentificationCacheObject } from "./project-identification/project-identification-cache.js";
export { ProjectIdentificationRegistryObject } from "./project-identification/project-identification-registry.js";

export { RepositoryMemoryObject } from "./memory/repository-memory-object.js";
