import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  MetricCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@holon/ui";
import * as React from "react";
import { Link } from "react-router";

import type { AnalyticsTrendData } from "../../workers/observability/analytics-client.js";
import type { QueueHealthData } from "../../workers/observability/queue-metrics-client.js";
import type { AdminRunRow, AdminSummaryMetrics } from "../../workers/types.js";
import { DegradedBanner } from "../components/degraded-banner.js";
import { LatencyChart } from "../components/latency-chart.js";
import { Layout } from "../components/layout.js";

export interface DashboardViewProps {
  readonly userEmail?: string | undefined;
  readonly window: "24h" | "7d" | "30d";
  readonly summary: AdminSummaryMetrics;
  readonly analyticsTrend: AnalyticsTrendData | null;
  readonly queueHealth: QueueHealthData | null;
  readonly recentRuns: AdminRunRow[];
  readonly degradedServices: string[];
  readonly watermark: {
    readonly enabledAt: string | null;
    readonly lastReceivedAt: string | null;
  };
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  userEmail,
  window,
  summary,
  analyticsTrend,
  queueHealth,
  recentRuns,
  degradedServices,
  watermark,
}) => {
  const successRate =
    summary.totalRuns > 0
      ? Math.round((summary.completedRuns / summary.totalRuns) * 100)
      : 0;

  const avgDurationSeconds =
    summary.averageExecutionDurationMs > 0
      ? (summary.averageExecutionDurationMs / 1000).toFixed(1)
      : "0.0";

  const totalTokensFormatted = summary.totalTokens.toLocaleString();

  const windows: Array<"24h" | "7d" | "30d"> = ["24h", "7d", "30d"];

  return (
    <Layout userEmail={userEmail} currentPath="/">
      {/* Degraded Alert */}
      <DegradedBanner degradedServices={degradedServices} />

      <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
        Data is available only from the projection cutover
        {watermark.enabledAt
          ? ` at ${new Date(watermark.enabledAt).toLocaleString()}`
          : " (watermark unavailable)"}
        .
        {watermark.lastReceivedAt
          ? ` Last projection received ${new Date(watermark.lastReceivedAt).toLocaleString()}.`
          : " No projection has been received yet."}
      </div>

      {/* Header & Window Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-950">
            System Overview
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Operational status and telemetry for autonomous code reviews
          </p>
        </div>

        {/* Time Window Switcher */}
        <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 text-xs">
          {windows.map((w) => (
            <Link
              key={w}
              to={`/?window=${w}`}
              className={`px-3 py-1 font-medium rounded-md transition-colors ${
                window === w
                  ? "bg-zinc-900 text-white shadow-xs"
                  : "text-zinc-600 hover:text-zinc-900"
              }`}
            >
              {w.toUpperCase()}
            </Link>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          label="Total Runs"
          value={summary.totalRuns.toLocaleString()}
          subtitle="Exact count from D1"
          tone="neutral"
        />
        <MetricCard
          label="Success Rate"
          value={`${successRate}%`}
          subtitle={`${summary.completedRuns} completed`}
          tone={
            successRate >= 90
              ? "success"
              : successRate >= 70
                ? "warning"
                : "danger"
          }
        />
        <MetricCard
          label="Avg Duration"
          value={`${avgDurationSeconds}s`}
          subtitle="Per executed run"
          tone="neutral"
        />
        <MetricCard
          label="Total Tokens"
          value={totalTokensFormatted}
          subtitle="Input + output + reasoning"
          tone="neutral"
        />
      </div>

      {/* Latency Trend & Verdict Distribution Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Latency Trend (Analytics Engine) */}
        <div className="lg:col-span-2">
          <LatencyChart trend={analyticsTrend} />
        </div>

        {/* Verdict Distribution Card */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Verdict Distribution</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <Badge variant="success" size="sm">
                  Approve
                </Badge>
                <span className="font-mono text-xs font-medium">
                  {summary.verdictDistribution.approve.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <Badge variant="danger" size="sm">
                  Request Changes
                </Badge>
                <span className="font-mono text-xs font-medium">
                  {summary.verdictDistribution.requestChanges.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <Badge variant="info" size="sm">
                  Comment
                </Badge>
                <span className="font-mono text-xs font-medium">
                  {summary.verdictDistribution.comment.toLocaleString()}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Queue Freshness Card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Queue Freshness</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Backlog Messages:</span>
                <span className="font-mono font-medium">
                  {queueHealth ? queueHealth.backlogCount : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Dead Letter Queue:</span>
                <span
                  className={`font-mono font-medium ${queueHealth && queueHealth.dlqCount > 0 ? "text-rose-600 font-bold" : ""}`}
                >
                  {queueHealth ? queueHealth.dlqCount : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Oldest Message:</span>
                <span className="font-mono font-medium">
                  {queueHealth?.oldestMessageAgeSeconds === undefined
                    ? "—"
                    : `${queueHealth.oldestMessageAgeSeconds}s`}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Pipeline State:</span>
                <Badge
                  variant={queueHealth?.isDegraded ? "warning" : "success"}
                  size="sm"
                  dot
                >
                  {queueHealth?.isDegraded ? "Degraded" : "Healthy"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent Runs Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle>Recent Projections</CardTitle>
          <Link
            to="/runs"
            className="text-xs font-medium text-zinc-600 hover:text-zinc-950 underline underline-offset-4"
          >
            View all runs &rarr;
          </Link>
        </CardHeader>
        <CardContent>
          {recentRuns.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-500">
              No review runs recorded in this time period.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Repository / PR</TableHead>
                  <TableHead>Verdict</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentRuns.map((run) => (
                  <TableRow key={run.run_id}>
                    <TableCell>
                      <div className="font-medium text-zinc-900">
                        {run.repository_owner}/{run.repository_name}#
                        {run.pr_number}
                      </div>
                      <div className="font-mono text-[11px] text-zinc-400 truncate max-w-xs">
                        {run.head_sha.slice(0, 7)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          run.verdict === "APPROVE"
                            ? "success"
                            : run.verdict === "REQUEST_CHANGES"
                              ? "danger"
                              : run.verdict === "COMMENT"
                                ? "info"
                                : "neutral"
                        }
                        size="sm"
                      >
                        {run.verdict ?? "UNSPECIFIED"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          run.terminal_state === "completed"
                            ? "success"
                            : run.terminal_state === "failed_terminal"
                              ? "danger"
                              : "neutral"
                        }
                        size="sm"
                      >
                        {run.terminal_state}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {run.execution_duration_ms
                        ? `${(run.execution_duration_ms / 1000).toFixed(1)}s`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-zinc-500">
                      {new Date(run.terminal_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        month: "short",
                        day: "numeric",
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        to={`/runs/${encodeURIComponent(run.run_id)}`}
                        className="text-xs font-medium text-zinc-700 hover:text-zinc-950 underline underline-offset-2"
                      >
                        Inspect
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </Layout>
  );
};
