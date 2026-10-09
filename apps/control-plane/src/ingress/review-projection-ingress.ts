import { webhookEnvelopeSchema } from "@holon/contracts";
import { createPrKey } from "@holon/domain";

import {
  dispatchReviewMessages,
  type QueueMessagePort,
  type WorkflowCreator,
} from "./queue-consumer.js";

export async function dispatchProjectedReviewMessages(
  messages: readonly QueueMessagePort[],
  env: {
    REVIEW_LEDGERS: Cloudflare.Env["REVIEW_LEDGERS"];
    REVIEW_WORKFLOW: WorkflowCreator;
  },
): Promise<void> {
  const accepted: QueueMessagePort[] = [];
  await Promise.all(
    messages.map(async (message) => {
      const parsed = webhookEnvelopeSchema.safeParse(message.body);
      if (!parsed.success) {
        message.ack();
        return;
      }
      const envelope = parsed.data;
      try {
        const key = createPrKey({
          provider: "github",
          repositoryId: envelope.repository.id,
          pullRequestNumber: envelope.pullRequest.number,
        });
        await env.REVIEW_LEDGERS.getByName(key).observePullRequest({
          installationId: envelope.installationId,
          repositoryId: envelope.repository.id,
          pullRequestNumber: envelope.pullRequest.number,
          title: envelope.pullRequest.title,
          author: envelope.pullRequest.author,
          pullRequestState: envelope.pullRequest.state,
          headSha: envelope.pullRequest.headSha,
          baseSha: envelope.pullRequest.baseSha,
          sourceUpdatedAt: new Date(
            envelope.pullRequest.updatedAt,
          ).toISOString(),
        });
        accepted.push(message);
      } catch {
        message.retry();
      }
    }),
  );
  await dispatchReviewMessages(accepted, env.REVIEW_WORKFLOW);
}
