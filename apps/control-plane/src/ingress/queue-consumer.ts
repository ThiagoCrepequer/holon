import {
  reviewJobSchema,
  webhookEnvelopeSchema,
  type ReviewJob,
  type WebhookEnvelope,
} from "@holon/contracts";
import { createPrKey, createRunId } from "@holon/domain";

export interface WorkflowCreator {
  createBatch(
    options: Array<{
      readonly id: string;
      readonly params: ReviewJob;
      readonly retention: {
        readonly errorRetention: "3 days";
        readonly successRetention: "1 day";
      };
    }>,
  ): Promise<unknown>;
  get(id: string): Promise<{ status(): Promise<unknown> }>;
}

export interface QueueMessagePort {
  readonly body: unknown;
  readonly id?: string;
  ack(): void;
  retry(): void;
}

async function deterministicWorkflowId(runId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(runId),
  );
  const hexadecimal = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `review-${hexadecimal}`;
}

interface PendingWorkflow {
  readonly id: string;
  readonly job: ReviewJob;
  readonly messages: QueueMessagePort[];
}

function workflowOptions(group: PendingWorkflow) {
  return {
    id: group.id,
    params: group.job,
    retention: {
      errorRetention: "3 days" as const,
      successRetention: "1 day" as const,
    },
  };
}

async function workflowExists(
  workflow: WorkflowCreator,
  id: string,
): Promise<boolean> {
  try {
    const instance = await workflow.get(id);
    await instance.status();
    return true;
  } catch {
    return false;
  }
}

function acknowledge(group: PendingWorkflow): void {
  for (const message of group.messages) message.ack();
}

function retry(group: PendingWorkflow): void {
  for (const message of group.messages) message.retry();
}

async function reconcileWorkflow(
  workflow: WorkflowCreator,
  group: PendingWorkflow,
): Promise<void> {
  if (await workflowExists(workflow, group.id)) {
    acknowledge(group);
    return;
  }
  try {
    // createBatch is idempotent in the production Workflows API: an existing
    // ID is omitted from the result rather than treated as an error.
    await workflow.createBatch([workflowOptions(group)]);

    acknowledge(group);
  } catch {
    // A dispatch can fail after the instance was durably created. Reconcile
    // once more before spending a Queue retry or sending the message to DLQ.
    if (await workflowExists(workflow, group.id)) {
      acknowledge(group);
    } else {
      retry(group);
    }
  }
}

export async function dispatchReviewMessages(
  messages: readonly QueueMessagePort[],
  workflow: WorkflowCreator,
): Promise<void> {
  const accepted: Array<{
    readonly job: ReviewJob;
    readonly message: QueueMessagePort;
  }> = [];
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
        runId: createRunId(
          prKey,
          envelope.pullRequest.headSha,
          envelope.pullRequest.baseSha,
        ),
      });
    } catch {
      // Invalid messages cannot become valid through redelivery. Acknowledge
      // them so poison payloads do not consume the queue retry budget.

      message.ack();
      continue;
    }
    accepted.push({ job, message });
  }
  if (accepted.length === 0) return;
  const groups = new Map<string, PendingWorkflow>();
  for (const { job, message } of accepted) {
    const id = await deterministicWorkflowId(job.runId);
    const existing = groups.get(id);
    if (existing === undefined) {
      groups.set(id, { id, job, messages: [message] });
    } else {
      existing.messages.push(message);
    }
  }
  const pending = [...groups.values()];
  try {
    await workflow.createBatch(pending.map(workflowOptions));
    for (const group of pending) acknowledge(group);
  } catch {
    // A batch rejection is ambiguous and may be partial. Isolate every ID so
    // an existing or successfully recreated Workflow never retries with a
    // genuinely unavailable one.
    for (const group of pending) {
      await reconcileWorkflow(workflow, group);
    }
  }
}
