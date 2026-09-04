/**
 * Holon Admin CLI - Dead Letter Queue (DLQ) Replay Tool
 *
 * Pulls failed projection messages from holon-admin-projections-dlq,
 * validates and requeues them to holon-admin-projections, and acks on DLQ
 * only after confirmed re-delivery.
 *
 * Security & Reliability Invariants:
 * - Default mode is --dry-run; --execute is required to mutate.
 * - --limit <1..1000> is mandatory when executing.
 * - Token CF_QUEUES_REPLAY_TOKEN is never logged, exposed or included in errors.
 * - Message bodies are never printed to logs or terminal.
 * - Non-zero exit code if any message fails to requeue or ack.
 */

export interface ReplayDlqConfig {
  readonly execute: boolean;
  readonly dryRun: boolean;
  readonly limit?: number | undefined;
  readonly batchSize: number;
  readonly visibilityTimeout: number;
  readonly accountId?: string | undefined;
  readonly mainQueueId?: string | undefined;
  readonly dlqId?: string | undefined;
  readonly apiToken?: string | undefined;
  readonly environment?: string | undefined;
}

export interface QueuePullMessage {
  readonly id: string;
  readonly lease_id: string;
  readonly body: unknown;
  readonly timestamp_ms?: number | undefined;
}

export interface ReplaySummary {
  readonly pulled: number;
  readonly requeued: number;
  readonly acked: number;
  readonly failed: number;
  readonly dryRun: boolean;
}

export function parseReplayDlqArgs(argv: string[]): ReplayDlqConfig {
  let execute = false;
  let limit: number | undefined = undefined;
  let batchSize = 10;
  let visibilityTimeout = 300;
  let accountId: string | undefined = undefined;
  let mainQueueId: string | undefined = undefined;
  let dlqId: string | undefined = undefined;
  let environment: string | undefined = undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--execute") {
      execute = true;
    } else if (arg === "--dry-run") {
      execute = false;
    } else if (arg === "--limit") {
      const next = argv[++i];
      const parsed = Number.parseInt(next ?? "", 10);
      if (Number.isNaN(parsed) || parsed < 1 || parsed > 1000) {
        throw new Error("Flag --limit must be an integer between 1 and 1000");
      }
      limit = parsed;
    } else if (arg === "--batch-size") {
      const next = argv[++i];
      const parsed = Number.parseInt(next ?? "", 10);
      if (Number.isNaN(parsed) || parsed < 1 || parsed > 100) {
        throw new Error(
          "Flag --batch-size must be an integer between 1 and 100",
        );
      }
      batchSize = parsed;
    } else if (arg === "--visibility-timeout") {
      const next = argv[++i];
      const parsed = Number.parseInt(next ?? "", 10);
      if (Number.isNaN(parsed) || parsed < 30 || parsed > 43200) {
        throw new Error(
          "Flag --visibility-timeout must be an integer between 30 and 43200 seconds",
        );
      }
      visibilityTimeout = parsed;
    } else if (arg === "--account-id") {
      accountId = argv[++i];
    } else if (arg === "--main-queue") {
      mainQueueId = argv[++i];
    } else if (arg === "--dlq") {
      dlqId = argv[++i];
    } else if (arg === "--env") {
      environment = argv[++i];
    }
  }

  if (execute && (limit === undefined || limit < 1)) {
    throw new Error(
      "Flag --limit <1..1000> is mandatory when executing with --execute",
    );
  }

  return {
    execute,
    dryRun: !execute,
    limit,
    batchSize,
    visibilityTimeout,
    accountId,
    mainQueueId,
    dlqId,
    environment,
  };
}

export class QueuesHttpClient {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async pullMessages(
    accountId: string,
    queueId: string,
    token: string,
    batchSize: number,
    visibilityTimeout: number,
  ): Promise<QueuePullMessage[]> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${queueId}/messages/pull`;
    const res = await this.fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        batch_size: batchSize,
        visibility_timeout: visibilityTimeout,
      }),
    });

    if (!res.ok) {
      throw new Error(`Queue pull failed with HTTP status ${res.status}`);
    }

    const data = (await res.json()) as {
      success?: boolean;
      result?: {
        messages?: QueuePullMessage[];
      };
    };

    if (!data.success && data.success !== undefined) {
      throw new Error("Queue pull returned unsuccessful response");
    }

    return data.result?.messages ?? [];
  }

  async sendMessage(
    accountId: string,
    queueId: string,
    token: string,
    body: unknown,
  ): Promise<{ success: boolean; id?: string | undefined }> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${queueId}/messages`;
    const res = await this.fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        body: typeof body === "string" ? body : JSON.stringify(body),
        content_type: "json",
      }),
    });

    if (!res.ok) {
      return { success: false };
    }

    const data = (await res.json()) as {
      success?: boolean;
      result?: { id?: string };
    };

    return {
      success: data.success ?? true,
      id: data.result?.id,
    };
  }

  async ackMessages(
    accountId: string,
    queueId: string,
    token: string,
    leaseIds: string[],
  ): Promise<{ success: boolean; ackedCount: number }> {
    if (leaseIds.length === 0) {
      return { success: true, ackedCount: 0 };
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${queueId}/messages/ack`;
    const res = await this.fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        acks: leaseIds.map((lease_id) => ({ lease_id })),
      }),
    });

    if (!res.ok) {
      return { success: false, ackedCount: 0 };
    }

    const data = (await res.json()) as { success?: boolean };
    return {
      success: data.success ?? true,
      ackedCount: data.success !== false ? leaseIds.length : 0,
    };
  }
}

export async function replayDlq(
  config: ReplayDlqConfig,
  client: QueuesHttpClient,
  envVars: Record<string, string | undefined> = process.env,
): Promise<ReplaySummary> {
  const accountId = config.accountId ?? envVars.CF_ACCOUNT_ID;
  const token = config.apiToken ?? envVars.CF_QUEUES_REPLAY_TOKEN;
  const mainQueueId =
    config.mainQueueId ??
    envVars.PROJECTION_QUEUE_ID ??
    "holon-admin-projections";
  const dlqId =
    config.dlqId ?? envVars.PROJECTION_DLQ_ID ?? "holon-admin-projections-dlq";

  if (!accountId || accountId.trim() === "") {
    throw new Error("Missing CF_ACCOUNT_ID environment variable or flag");
  }
  if (!token || token.trim() === "") {
    throw new Error("Missing CF_QUEUES_REPLAY_TOKEN environment variable");
  }

  if (config.dryRun) {
    const pullBatch = Math.min(config.batchSize, config.limit ?? 10);
    const messages = await client.pullMessages(
      accountId,
      dlqId,
      token,
      pullBatch,
      config.visibilityTimeout,
    );

    return {
      pulled: messages.length,
      requeued: 0,
      acked: 0,
      failed: 0,
      dryRun: true,
    };
  }

  // Execute mode
  const limit = config.limit ?? 10;
  let totalPulled = 0;
  let totalRequeued = 0;
  let totalAcked = 0;
  let totalFailed = 0;

  while (totalRequeued + totalFailed < limit) {
    const remaining = limit - (totalRequeued + totalFailed);
    const currentBatchSize = Math.min(config.batchSize, remaining);

    const messages = await client.pullMessages(
      accountId,
      dlqId,
      token,
      currentBatchSize,
      config.visibilityTimeout,
    );

    if (messages.length === 0) {
      break;
    }

    totalPulled += messages.length;

    for (const msg of messages) {
      const sendResult = await client.sendMessage(
        accountId,
        mainQueueId,
        token,
        msg.body,
      );

      if (!sendResult.success) {
        totalFailed++;
        continue;
      }

      totalRequeued++;

      const ackResult = await client.ackMessages(accountId, dlqId, token, [
        msg.lease_id,
      ]);

      if (ackResult.success && ackResult.ackedCount > 0) {
        totalAcked++;
      } else {
        totalFailed++;
      }
    }
  }

  return {
    pulled: totalPulled,
    requeued: totalRequeued,
    acked: totalAcked,
    failed: totalFailed,
    dryRun: false,
  };
}

export async function runCli(
  argv: string[],
  envVars: Record<string, string | undefined> = process.env,
  client: QueuesHttpClient = new QueuesHttpClient(),
): Promise<number> {
  try {
    const config = parseReplayDlqArgs(argv);
    console.log(
      `[Replay-DLQ] Starting run (mode: ${config.execute ? "EXECUTE" : "DRY-RUN"})`,
    );

    const summary = await replayDlq(config, client, envVars);

    console.log(
      `[Replay-DLQ] Finished: pulled=${summary.pulled}, requeued=${summary.requeued}, acked=${summary.acked}, failed=${summary.failed} (dryRun=${summary.dryRun})`,
    );

    if (summary.failed > 0) {
      console.error(
        `[Replay-DLQ] Completed with ${summary.failed} message failure(s).`,
      );
      return 1;
    }

    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Replay-DLQ] Error: ${msg}`);
    return 1;
  }
}
