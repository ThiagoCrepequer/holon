import {
  reviewJobSchema,
  webhookEnvelopeSchema,
  type ReviewJob,
  type WebhookEnvelope,
} from "@holon/contracts";
import { createPrKey, createRunId } from "@holon/domain";
import {
  consoleErrorReporter,
  reportError,
  type ErrorReporter,
} from "@holon/observability";

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
  readonly messageIndex: number;
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
  reporter: ErrorReporter,
  batchError: unknown,
): Promise<void> {
  const context = {
    component: "control-plane",
    operation: "queue.workflow_dispatch",
    workflowInstanceId: group.id,
    runId: group.job.runId,
    repositoryId: group.job.envelope.repository.id,
    pullRequestNumber: group.job.envelope.pullRequest.number,
    messageIndex: group.messageIndex,
  };
  if (await workflowExists(workflow, group.id)) {
    reportError(reporter, "queue.workflow_dispatch_recovered", batchError, {
      ...context,
      disposition: "recovered",
    });
    acknowledge(group);
    return;
  }
  try {
    // createBatch is idempotent in the production Workflows API: an existing
    // ID is omitted from the result rather than treated as an error.
    await workflow.createBatch([workflowOptions(group)]);
    reportError(reporter, "queue.workflow_dispatch_recovered", batchError, {
      ...context,
      disposition: "recovered",
    });
    acknowledge(group);
  } catch (error) {
    // A dispatch can fail after the instance was durably created. Reconcile
    // once more before spending a Queue retry or sending the message to DLQ.
    if (await workflowExists(workflow, group.id)) {
      reportError(reporter, "queue.workflow_dispatch_recovered", error, {
        ...context,
        disposition: "recovered",
      });
      acknowledge(group);
    } else {
      reportError(reporter, "queue.workflow_dispatch_failed", error, {
        ...context,
        disposition: "retry",
      });
      retry(group);
    }
  }
}

export async function dispatchReviewMessages(
  messages: readonly QueueMessagePort[],
  workflow: WorkflowCreator,
  reporter: ErrorReporter = consoleErrorReporter,
): Promise<void> {
  const accepted: Array<{
    readonly job: ReviewJob;
    readonly message: QueueMessagePort;
    readonly messageIndex: number;
  }> = [];
  for (const [messageIndex, message] of messages.entries()) {
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
    } catch (error) {
      // Invalid messages cannot become valid through redelivery. Acknowledge
      // them so poison payloads do not consume the queue retry budget.
      reportError(reporter, "queue.message_invalid", error, {
        component: "control-plane",
        operation: "queue.validate",
        messageId: message.id,
        messageIndex,
        disposition: "ack",
      });
      message.ack();
      continue;
    }
    accepted.push({ job, message, messageIndex });
  }
  if (accepted.length === 0) return;
  const groups = new Map<string, PendingWorkflow>();
  for (const { job, message, messageIndex } of accepted) {
    const id = await deterministicWorkflowId(job.runId);
    const existing = groups.get(id);
    if (existing === undefined) {
      groups.set(id, { id, job, messageIndex, messages: [message] });
    } else {
      existing.messages.push(message);
    }
  }
  const pending = [...groups.values()];
  try {
    await workflow.createBatch(pending.map(workflowOptions));
    for (const group of pending) acknowledge(group);
  } catch (error) {
    reportError(reporter, "queue.batch_dispatch_failed", error, {
      component: "control-plane",
      operation: "queue.create_batch",
      batchSize: pending.length,
    });
    // A batch rejection is ambiguous and may be partial. Isolate every ID so
    // an existing or successfully recreated Workflow never retries with a
    // genuinely unavailable one.
    for (const group of pending) {
      await reconcileWorkflow(workflow, group, reporter, error);
    }
  }
}
