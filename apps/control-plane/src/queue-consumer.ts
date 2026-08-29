import {
  reviewJobSchema,
  webhookEnvelopeSchema,
  type ReviewJob,
  type WebhookEnvelope,
} from "@holon/contracts";
import { createPrKey, createRunId } from "@holon/domain";

export interface WorkflowCreator {
  create(options: { readonly params: ReviewJob }): Promise<unknown>;
}

export interface QueueMessagePort {
  readonly body: unknown;
  ack(): void;
  retry(): void;
}

export async function dispatchReviewMessages(
  messages: readonly QueueMessagePort[],
  workflow: WorkflowCreator,
): Promise<void> {
  for (const message of messages) {
    try {
      const envelope: WebhookEnvelope = webhookEnvelopeSchema.parse(
        message.body,
      );
      const prKey = createPrKey({
        provider: "github",
        pullRequestNumber: envelope.pullRequest.number,
        repositoryId: envelope.repository.id,
      });
      const job = reviewJobSchema.parse({
        envelope,
        runId: createRunId(prKey, envelope.pullRequest.headSha),
        schemaVersion: 1,
      });
      await workflow.create({ params: job });
      message.ack();
    } catch {
      message.retry();
    }
  }
}
