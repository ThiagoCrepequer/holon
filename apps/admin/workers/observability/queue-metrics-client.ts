/**
 * Cloudflare Queues Metrics client.
 * Fetches backlog and DLQ metrics to monitor projection freshness and health.
 */

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
}

export async function queryQueueHealth(
  config: QueueMetricsConfig,
): Promise<QueueMetricsResult> {
  const { accountId, apiToken, queueId, dlqId, fetchFn = fetch } = config;

  if (!accountId || !apiToken || !queueId) {
    return { status: "unavailable", reason: "missing_configuration" };
  }

  const headers = {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };

  try {
    const queueUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${queueId}`;
    const queuePromise = fetchFn(queueUrl, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(3000),
    });

    let dlqPromise: Promise<Response> | null = null;
    if (dlqId) {
      const dlqUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${dlqId}`;
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

    if (!queueRes.ok) {
      return { status: "unavailable", reason: "queue_api_error" };
    }

    const queueData = (await queueRes.json()) as {
      result?: {
        messages?: number;
        delayed_messages?: number;
      };
    };

    let dlqCount = 0;
    if (dlqRes && dlqRes.ok) {
      const dlqData = (await dlqRes.json()) as {
        result?: {
          messages?: number;
        };
      };
      dlqCount = dlqData.result?.messages ?? 0;
    }

    const backlogCount =
      (queueData.result?.messages ?? 0) +
      (queueData.result?.delayed_messages ?? 0);
    const isDegraded = dlqCount > 0 || backlogCount > 100;

    return {
      status: "ok",
      data: {
        backlogCount,
        dlqCount,
        isDegraded,
      },
    };
  } catch {
    return { status: "unavailable", reason: "request_failed" };
  }
}
