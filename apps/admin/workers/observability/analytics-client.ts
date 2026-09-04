/**
 * Cloudflare Analytics Engine server-side read client.
 * Provides approximate latency percentiles (p50/p95) and trends.
 * Fails gracefully to { status: "unavailable" } on any network or API issue.
 */

export interface AnalyticsTrendData {
  readonly p50DurationMs: number;
  readonly p95DurationMs: number;
  readonly sampledRunsCount: number;
  readonly window: "24h" | "7d" | "30d";
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
  const sql = `
    SELECT
      quantiles(0.50, 0.95)(double1) AS latency_quantiles,
      count() AS sampled_count
    FROM ${datasetName}
    WHERE timestamp >= NOW() - INTERVAL '${hours}' HOUR
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

    const payload = (await response.json()) as {
      data?: Array<{
        latency_quantiles?: [number, number];
        sampled_count?: number;
      }>;
    };

    const row = payload.data?.[0];
    const quantiles = row?.latency_quantiles;
    const p50 =
      typeof quantiles?.[0] === "number" ? Math.round(quantiles[0]) : 0;
    const p95 =
      typeof quantiles?.[1] === "number" ? Math.round(quantiles[1]) : 0;
    const count =
      typeof row?.sampled_count === "number" ? row.sampled_count : 0;

    return {
      status: "ok",
      data: {
        p50DurationMs: p50,
        p95DurationMs: p95,
        sampledRunsCount: count,
        window,
      },
    };
  } catch {
    return { status: "unavailable", reason: "request_failed" };
  }
}
