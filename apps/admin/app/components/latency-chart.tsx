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
  const fallback = (
    <div
      className="h-80 animate-pulse rounded-lg border border-zinc-200 bg-zinc-100"
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
