/**
 * Cloudflare Queues Metrics client.
 * Fetches backlog and DLQ metrics to monitor projection freshness and health.
 */

import { z } from "zod";

import { readBoundedJson } from "./bounded-json.js";

export interface QueueHealthData {
  readonly backlogCount: number;
  readonly dlqCount: number;
  readonly oldestMessageAgeSeconds?: number | undefined;
  readonly isDegraded: boolean;
}

export type QueueMetricsResult =
  | { readonly status: "ok"; readonly data: QueueHealthData }
  | { readonly status: "unavailable"; readonly reason?: string | undefined };

export interface QueueMetricsConfig {
  readonly accountId?: string | undefined;
  readonly apiToken?: string | undefined;
  readonly queueId?: string | undefined;
  readonly dlqId?: string | undefined;
  readonly fetchFn?: typeof fetch | undefined;
  readonly nowEpochMs?: (() => number) | undefined;
  readonly maxOldestMessageAgeSeconds?: number | undefined;
}

const queueMetricsResponseSchema = z.object({
  success: z.literal(true),
  result: z.object({
    backlog_count: z.coerce.number().int().nonnegative(),
    oldest_message_timestamp_ms: z.coerce.number().int().nonnegative(),
  }),
});

export async function queryQueueHealth(
  config: QueueMetricsConfig,
): Promise<QueueMetricsResult> {
  const {
    accountId,
    apiToken,
    queueId,
    dlqId,
    fetchFn = fetch,
    nowEpochMs = Date.now,
    maxOldestMessageAgeSeconds = 300,
  } = config;

  if (!accountId || !apiToken || !queueId) {
    return { status: "unavailable", reason: "missing_configuration" };
  }

  const headers = {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };

  try {
    const queueUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${queueId}/metrics`;
    const queuePromise = fetchFn(queueUrl, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(3000),
    });

    let dlqPromise: Promise<Response> | null = null;
    if (dlqId) {
      const dlqUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${dlqId}/metrics`;
      dlqPromise = fetchFn(dlqUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(3000),
      });
    }

    const [queueRes, dlqRes] = await Promise.all([
      queuePromise,
      dlqPromise ? dlqPromise : Promise.resolve(null),
    ]);

    if (!queueRes.ok || (dlqRes && !dlqRes.ok)) {
      return { status: "unavailable", reason: "queue_api_error" };
    }

    const queueData = queueMetricsResponseSchema.parse(
      await readBoundedJson(queueRes),
    );

    let dlqCount = 0;
    if (dlqRes) {
      const dlqData = queueMetricsResponseSchema.parse(
        await readBoundedJson(dlqRes),
      );
      dlqCount = dlqData.result.backlog_count;
    }

    const backlogCount = queueData.result.backlog_count;
    const oldestMessageAgeSeconds =
      backlogCount > 0 && queueData.result.oldest_message_timestamp_ms > 0
        ? Math.max(
            0,
            Math.floor(
              (nowEpochMs() - queueData.result.oldest_message_timestamp_ms) /
                1000,
            ),
          )
        : undefined;
    const isDegraded =
      oldestMessageAgeSeconds !== undefined &&
      oldestMessageAgeSeconds > maxOldestMessageAgeSeconds;

    return {
      status: "ok",
      data: {
        backlogCount,
        dlqCount,
        oldestMessageAgeSeconds,
        isDegraded,
      },
    };
  } catch {
    return { status: "unavailable", reason: "request_failed" };
  }
}
