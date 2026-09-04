import {
  ChartFrame,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@holon/ui";
import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { AnalyticsTrendData } from "../../workers/observability/analytics-client.js";

export function formatBucketTick(value: unknown): string {
  return String(value).slice(5, 16);
}

export function formatRoundedDuration(value: unknown): string {
  return `${Math.round(Number(value) / 1000)}s`;
}

export function formatPreciseDuration(value: unknown): string {
  return `${(Number(value) / 1000).toFixed(2)}s`;
}

export default function LatencyChartClient({
  trend,
}: {
  readonly trend: AnalyticsTrendData | null;
}) {
  const points = trend?.points ?? [];
  const [showTable, setShowTable] = useState(false);
  return (
    <ChartFrame
      title="Latency Trend (Percentiles)"
      description="Sample-adjusted p50 and p95 execution latency from Analytics Engine"
      empty={points.length === 0}
      emptyMessage="Analytics Engine latency data is currently unavailable"
      onToggleTable={() => setShowTable((current) => !current)}
      showTable={showTable}
      accessibleTable={
        points.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bucket</TableHead>
                <TableHead>p50</TableHead>
                <TableHead>p95</TableHead>
                <TableHead>Estimated runs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {points.map((point) => (
                <TableRow key={point.bucket}>
                  <TableCell>{point.bucket}</TableCell>
                  <TableCell>
                    {formatPreciseDuration(point.p50DurationMs)}
                  </TableCell>
                  <TableCell>
                    {formatPreciseDuration(point.p95DurationMs)}
                  </TableCell>
                  <TableCell>{point.sampledRunsCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : undefined
      }
    >
      {points.length > 0 ? (
        <div
          className="h-64 w-full"
          role="img"
          aria-label="Latency trend chart; use the accessible data table for exact values"
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={280}
            minHeight={256}
          >
            <LineChart
              data={points}
              margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
            >
              <CartesianGrid
                stroke="#e4e4e7"
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                dataKey="bucket"
                tick={{ fontSize: 10 }}
                tickFormatter={formatBucketTick}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                tickFormatter={formatRoundedDuration}
              />
              <Tooltip formatter={formatPreciseDuration} />
              <Line
                type="monotone"
                dataKey="p50DurationMs"
                name="p50"
                stroke="#2563eb"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="p95DurationMs"
                name="p95"
                stroke="#f97316"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </ChartFrame>
  );
}
