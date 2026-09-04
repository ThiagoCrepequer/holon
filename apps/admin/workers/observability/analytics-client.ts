/**
 * Cloudflare Analytics Engine server-side read client.
 * Provides approximate latency percentiles (p50/p95) and trends.
 * Fails gracefully to { status: "unavailable" } on any network or API issue.
 */

import { z } from "zod";

import { readBoundedJson } from "./bounded-json.js";

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
  | { readonly status: "unavailable"; readonly reason?: string | undefined };

export interface AnalyticsClientConfig {
  readonly accountId?: string | undefined;
  readonly apiToken?: string | undefined;
  readonly datasetName?: string | undefined;
  readonly fetchFn?: typeof fetch | undefined;
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

export async function queryAnalyticsTrend(
  window: "24h" | "7d" | "30d",
  config: AnalyticsClientConfig,
): Promise<AnalyticsQueryResult> {
  const {
    accountId,
    apiToken,
    datasetName = "holon_telemetry_events",
    fetchFn = fetch,
  } = config;

  if (!accountId || !apiToken) {
    return { status: "unavailable", reason: "missing_credentials" };
  }

  const hours = window === "24h" ? 24 : window === "7d" ? 168 : 720;
  const bucket =
    window === "24h" ? "1 HOUR" : window === "7d" ? "6 HOUR" : "1 DAY";
  const sql = `
    SELECT
      toStartOfInterval(timestamp, INTERVAL '${bucket}') AS bucket,
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
      return { status: "unavailable", reason: "upstream_error" };
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
    return { status: "unavailable", reason: "request_failed" };
  }
}
