/**
 * Cloudflare Analytics Engine server-side read client.
 * Provides approximate latency percentiles (p50/p95) and trends.
 * Fails gracefully to { status: "unavailable" } on any network or API issue.
 */

import { z } from "zod";

import { readBoundedJson } from "./bounded-json.js";
import {
  consoleObservabilityLogger,
  type IntegrationUnavailableReason,
  type ObservabilityLogger,
} from "./safe-log.js";

export interface AnalyticsTrendPoint {
  readonly bucket: string;
  readonly p50DurationMs: number;
  readonly p95DurationMs: number;
  readonly sampledRunsCount: number;
}

export interface AnalyticsTrendData {
  readonly p50DurationMs: number;
  readonly p95DurationMs: number;
  readonly sampledRunsCount: number;
  readonly window: "24h" | "7d" | "30d";
  readonly points: readonly AnalyticsTrendPoint[];
}

export type AnalyticsQueryResult =
  | { readonly status: "ok"; readonly data: AnalyticsTrendData }
  | {
      readonly status: "unavailable";
      readonly reason: IntegrationUnavailableReason;
    };

export interface AnalyticsClientConfig {
  readonly accountId?: string | undefined;
  readonly apiToken?: string | undefined;
  readonly datasetName?: string | undefined;
  readonly fetchFn?: typeof fetch | undefined;
  readonly logger?: ObservabilityLogger | undefined;
}

const analyticsResponseSchema = z.object({
  data: z.array(
    z.object({
      bucket: z.string().min(1),
      p50_duration_ms: z.coerce.number().finite().nonnegative(),
      p95_duration_ms: z.coerce.number().finite().nonnegative(),
      sampled_count: z.coerce.number().int().nonnegative(),
    }),
  ),
});

const analyticsWindowSql = {
  "24h": { bucketInterval: "INTERVAL '1' HOUR", hours: 24 },
  "7d": { bucketInterval: "INTERVAL '6' HOUR", hours: 168 },
  "30d": { bucketInterval: "INTERVAL '1' DAY", hours: 720 },
} as const satisfies Record<
  "24h" | "7d" | "30d",
  { readonly bucketInterval: string; readonly hours: number }
>;

export async function queryAnalyticsTrend(
  window: "24h" | "7d" | "30d",
  config: AnalyticsClientConfig,
): Promise<AnalyticsQueryResult> {
  const {
    accountId,
    apiToken,
    datasetName = "holon_telemetry_events",
    fetchFn = fetch,
    logger = consoleObservabilityLogger,
  } = config;

  const unavailable = (
    reason: IntegrationUnavailableReason,
    upstreamStatus?: number,
  ): AnalyticsQueryResult => {
    logger({
      event: "holon.admin.integration_unavailable",
      integration: "analytics_engine",
      reason,
      ...(upstreamStatus === undefined ? {} : { upstreamStatus }),
    });
    return { status: "unavailable", reason };
  };

  if (!accountId || !apiToken) {
    return unavailable("missing_configuration");
  }

  const { bucketInterval, hours } = analyticsWindowSql[window];
  const sql = `
    SELECT
      toStartOfInterval(timestamp, ${bucketInterval}) AS bucket,
      quantileExactWeighted(0.50)(double1, _sample_interval) AS p50_duration_ms,
      quantileExactWeighted(0.95)(double1, _sample_interval) AS p95_duration_ms,
      sum(_sample_interval) AS sampled_count
    FROM ${datasetName}
    WHERE timestamp >= NOW() - INTERVAL '${hours}' HOUR
    GROUP BY bucket
    ORDER BY bucket ASC
  `.trim();

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`;

  try {
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "text/plain; charset=utf-8",
      },
      body: sql,
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return unavailable("upstream_error", response.status);
    }

    const payload = analyticsResponseSchema.parse(
      await readBoundedJson(response),
    );
    const points = payload.data.map((row) => ({
      bucket: row.bucket,
      p50DurationMs: Math.round(row.p50_duration_ms),
      p95DurationMs: Math.round(row.p95_duration_ms),
      sampledRunsCount: row.sampled_count,
    }));
    const latest = points.at(-1);

    return {
      status: "ok",
      data: {
        p50DurationMs: latest?.p50DurationMs ?? 0,
        p95DurationMs: latest?.p95DurationMs ?? 0,
        sampledRunsCount: points.reduce(
          (total, point) => total + point.sampledRunsCount,
          0,
        ),
        window,
        points,
      },
    };
  } catch {
    return unavailable("request_failed");
  }
}
