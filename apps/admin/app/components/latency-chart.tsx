import { ChartFrame } from "@holon/ui";
import { lazy, Suspense } from "react";

import type { AnalyticsTrendData } from "../../workers/observability/analytics-client.js";
import { useHydrated } from "../hooks/use-hydrated.js";

const LatencyChartClient = lazy(() => import("./latency-chart.client.js"));

export function LatencyChart({
  trend,
}: {
  readonly trend: AnalyticsTrendData | null;
}) {
  const hydrated = useHydrated();
  if (!trend || trend.points.length === 0) {
    return (
      <ChartFrame
        title="Latency Trend (Percentiles)"
        description="Median and 95th percentile execution time"
        empty
        emptyTitle={
          trend ? "No latency samples" : "Latency metrics unavailable"
        }
        emptyMessage={
          trend
            ? "No execution latency samples were recorded in this period."
            : "Analytics Engine latency data is currently unavailable"
        }
        className="latency-chart h-full"
        height={220}
      />
    );
  }
  const fallback = (
    <div
      className="h-full min-h-[320px] animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface-hover)]"
      aria-label="Loading latency chart"
    />
  );
  if (!hydrated) return fallback;
  return (
    <Suspense fallback={fallback}>
      <LatencyChartClient trend={trend} />
    </Suspense>
  );
}
