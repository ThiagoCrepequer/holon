import type { AdminRunDetailV2 } from "@holon/contracts";
import { z } from "zod";

import type { AdminEnv } from "../app.js";
import { queryAnalyticsTrend } from "./analytics-client.js";
import { queryQueueHealth } from "./queue-metrics-client.js";

export type ComponentHealth = "healthy" | "degraded" | "unknown";

export interface AdminReadRpcClient {
  pingV1(): Promise<{ schemaVersion: 1 }>;
  getRunDetailV2(request: { runId: string }): Promise<AdminRunDetailV2 | null>;
}

export interface ReadinessReport {
  readonly status: "healthy" | "degraded" | "partial";
  readonly timestamp: string;
  readonly checks: {
    readonly d1: ComponentHealth;
    readonly rpc: ComponentHealth;
    readonly analyticsEngine: ComponentHealth;
    readonly queueMetrics: ComponentHealth;
  };
}

const rpcPingResponseSchema = z.object({ schemaVersion: z.literal(1) });

export async function checkReadiness(
  env: AdminEnv,
  fetchFn: typeof fetch = fetch,
): Promise<ReadinessReport> {
  const timestamp = new Date().toISOString();

  // Probe 1: D1 Database (SELECT 1 with 1s timeout)
  const probeD1 = async (): Promise<ComponentHealth> => {
    try {
      if (!env.DB) return "degraded";
      const stmt = env.DB.prepare("SELECT 1 AS alive");
      const res = await Promise.race([
        stmt.first<{ alive: number }>(),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error("D1 timeout")), 1000),
        ),
      ]);
      return res?.alive === 1 ? "healthy" : "degraded";
    } catch {
      return "degraded";
    }
  };

  // Probe 2: RPC entrypoint pingV1 (2s timeout)
  const probeRpc = async (): Promise<ComponentHealth> => {
    try {
      const rpcClient = env.ADMIN_READ_API as unknown as
        | AdminReadRpcClient
        | undefined;
      if (!rpcClient) return "degraded";
      const res = await Promise.race([
        rpcClient.pingV1(),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error("RPC timeout")), 2000),
        ),
      ]);
      return rpcPingResponseSchema.safeParse(res).success
        ? "healthy"
        : "degraded";
    } catch {
      return "degraded";
    }
  };

  // Probe 3: Analytics Engine
  const probeAnalytics = async (): Promise<ComponentHealth> => {
    if (!env.CF_ACCOUNT_ID || !env.CF_ANALYTICS_API_TOKEN) {
      return "unknown";
    }
    const res = await queryAnalyticsTrend("24h", {
      accountId: env.CF_ACCOUNT_ID,
      apiToken: env.CF_ANALYTICS_API_TOKEN,
      fetchFn,
    });
    return res.status === "ok" ? "healthy" : "unknown";
  };

  // Probe 4: Queue Metrics
  const probeQueue = async (): Promise<ComponentHealth> => {
    if (
      !env.CF_ACCOUNT_ID ||
      !env.CF_QUEUES_READ_TOKEN ||
      !env.PROJECTION_QUEUE_ID
    ) {
      return "unknown";
    }
    const res = await queryQueueHealth({
      accountId: env.CF_ACCOUNT_ID,
      apiToken: env.CF_QUEUES_READ_TOKEN,
      queueId: env.PROJECTION_QUEUE_ID,
      dlqId: env.PROJECTION_DLQ_ID,
      fetchFn,
    });
    if (res.status !== "ok") return "unknown";
    return res.data.isDegraded ? "degraded" : "healthy";
  };

  const [d1Result, rpcResult, analyticsResult, queueResult] = await Promise.all(
    [probeD1(), probeRpc(), probeAnalytics(), probeQueue()],
  );

  const checks = {
    d1: d1Result,
    rpc: rpcResult,
    analyticsEngine: analyticsResult,
    queueMetrics: queueResult,
  };

  let status: "healthy" | "degraded" | "partial" = "healthy";
  if (
    checks.d1 === "degraded" ||
    checks.rpc === "degraded" ||
    checks.queueMetrics === "degraded"
  ) {
    status = "degraded";
  } else if (
    checks.analyticsEngine === "unknown" ||
    checks.queueMetrics === "unknown"
  ) {
    status = "partial";
  }

  return {
    status,
    timestamp,
    checks,
  };
}
