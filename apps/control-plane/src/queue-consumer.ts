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
    let job: ReviewJob;
    try {
      const envelope: WebhookEnvelope = webhookEnvelopeSchema.parse(
        message.body,
      );
      const prKey = createPrKey({
        provider: "github",
        pullRequestNumber: envelope.pullRequest.number,
        repositoryId: envelope.repository.id,
      });
      job = reviewJobSchema.parse({
        envelope,
        runId: createRunId(prKey, envelope.pullRequest.headSha),
        schemaVersion: 1,
      });
    } catch {
      // Invalid messages cannot become valid through redelivery. Acknowledge
      // them so poison payloads do not consume the queue retry budget.
      message.ack();
      continue;
    }
    try {
      await workflow.create({ params: job });
      message.ack();
    } catch {
      message.retry();
    }
  }
}
