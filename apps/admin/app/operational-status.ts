import type { AnalyticsQueryResult } from "../workers/observability/analytics-client.js";
import type { QueueMetricsResult } from "../workers/observability/queue-metrics-client.js";

export type OperationalService = "Analytics Engine" | "Queue Pipeline";
export type OperationalServiceState = "degraded" | "unavailable";

export interface OperationalNotice {
  readonly service: OperationalService;
  readonly state: OperationalServiceState;
}

export function deriveOperationalNotices(
  analytics: AnalyticsQueryResult,
  queues: QueueMetricsResult,
): OperationalNotice[] {
  const notices: OperationalNotice[] = [];

  if (analytics.status === "unavailable") {
    notices.push({ service: "Analytics Engine", state: "unavailable" });
  }

  if (queues.status === "unavailable") {
    notices.push({ service: "Queue Pipeline", state: "unavailable" });
  } else if (queues.data.isDegraded) {
    notices.push({ service: "Queue Pipeline", state: "degraded" });
  }

  return notices;
}
