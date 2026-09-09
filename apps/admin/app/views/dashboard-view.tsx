import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
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
import { ConsoleIcon } from "../components/console-icon.js";
import { LatencyChart } from "../components/latency-chart.js";
import { Layout } from "../components/layout.js";
import { OperationalStatusBanner } from "../components/operational-status-banner.js";
import { PageHeader } from "../components/page-header.js";
import { VerdictDistribution } from "../components/verdict-distribution.js";
import type { OperationalNotice } from "../operational-status.js";
import {
  formatDateTimeUtc,
  formatNumber,
  formatTableDateTimeUtc,
} from "../utils/format.js";

export interface DashboardViewProps {
  readonly userEmail?: string | undefined;
  readonly window: "24h" | "7d" | "30d";
  readonly summary: AdminSummaryMetrics;
  readonly analyticsTrend: AnalyticsTrendData | null;
  readonly queueHealth: QueueHealthData | null;
  readonly recentRuns: AdminRunRow[];
  readonly operationalNotices: readonly OperationalNotice[];
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
  operationalNotices,
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

  const totalTokensFormatted = formatNumber(summary.totalTokens);

  const windows: Array<"24h" | "7d" | "30d"> = ["24h", "7d", "30d"];

  return (
    <Layout userEmail={userEmail} currentPath="/">
      {/* Header & Window Selector */}
      <PageHeader
        title="System Overview"
        description="Review outcomes, execution time and repository activity."
      >
        {/* Time Window Switcher */}
        <div className="window-selector" role="group" aria-label="Time window">
          {windows.map((w) => (
            <Link
              key={w}
              to={`/?window=${w}`}
              aria-current={window === w ? "true" : undefined}
              className={window === w ? "is-active" : undefined}
            >
              {w.toUpperCase()}
            </Link>
          ))}
        </div>
      </PageHeader>

      <OperationalStatusBanner notices={operationalNotices} />

      {/* KPI Cards */}
      <div className="dashboard-metrics">
        <MetricCard
          icon={<ConsoleIcon name="runs" />}
          label="Total Runs"
          value={formatNumber(summary.totalRuns)}
          subtitle="Reviews in this period"
          tone="neutral"
        />
        <MetricCard
          icon={<ConsoleIcon name="pulse" />}
          label="Success Rate"
          value={summary.totalRuns === 0 ? "—" : `${successRate}%`}
          subtitle={
            summary.totalRuns === 0
              ? "No reviews in this period"
              : `${formatNumber(summary.completedRuns)} completed`
          }
          tone={
            summary.totalRuns === 0
              ? "neutral"
              : successRate >= 90
                ? "success"
                : successRate >= 70
                  ? "warning"
                  : "danger"
          }
        />
        <MetricCard
          icon={<ConsoleIcon name="clock" />}
          label="Avg Duration"
          value={summary.totalRuns === 0 ? "—" : `${avgDurationSeconds}s`}
          subtitle="Per executed run"
          tone="neutral"
        />
        <MetricCard
          icon={<ConsoleIcon name="tokens" />}
          label="Total Tokens"
          value={totalTokensFormatted}
          subtitle="Input + output + reasoning"
          tone="neutral"
        />
      </div>

      {/* Latency Trend & Verdict Distribution Grid */}
      <div className="dashboard-analysis">
        {/* Latency Trend (Analytics Engine) */}
        <div className="latency-panel">
          <LatencyChart trend={analyticsTrend} />
        </div>

        {/* Verdict Distribution & Queue Freshness Stacked Column */}
        <div className="dashboard-side-panels">
          <VerdictDistribution distribution={summary.verdictDistribution} />

          {/* Queue Freshness Card */}
          <Card className="dashboard-panel queue-panel">
            <CardHeader className="pb-2">
              <CardTitle>Queue Freshness</CardTitle>
            </CardHeader>
            <CardContent className="queue-content space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)] font-medium">
                  Backlog Messages:
                </span>
                <span className="font-mono font-semibold text-[var(--text-primary)]">
                  {queueHealth ? queueHealth.backlogCount : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)] font-medium">
                  Dead Letter Queue:
                </span>
                <span
                  className={`font-mono font-semibold ${queueHealth && queueHealth.dlqCount > 0 ? "text-[var(--danger-text)] font-bold" : "text-[var(--text-primary)]"}`}
                >
                  {queueHealth ? queueHealth.dlqCount : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)] font-medium">
                  Oldest Message:
                </span>
                <span className="font-mono font-semibold text-[var(--text-primary)]">
                  {queueHealth?.oldestMessageAgeSeconds === undefined
                    ? "—"
                    : `${queueHealth.oldestMessageAgeSeconds}s`}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)] font-medium">
                  Pipeline State:
                </span>
                <Badge
                  variant={
                    queueHealth === null
                      ? "info"
                      : queueHealth.isDegraded
                        ? "warning"
                        : "success"
                  }
                  size="sm"
                  dot
                >
                  {queueHealth === null
                    ? "Unavailable"
                    : queueHealth.isDegraded
                      ? "Degraded"
                      : "Healthy"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent Runs Table */}
      <Card className="dashboard-panel recent-runs">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle>Recent reviews</CardTitle>
          <Link to="/runs" className="console-text-link">
            View all runs &rarr;
          </Link>
        </CardHeader>
        <CardContent className="px-3 pb-3 pt-0 overflow-hidden rounded-b-xl">
          {recentRuns.length === 0 ? (
            <div className="reviews-empty">
              <EmptyState
                title="No review runs recorded"
                description="Completed, failed and superseded reviews will appear here after their results arrive."
              />
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
                      <div className="font-medium text-[var(--text-primary)]">
                        {run.repository_owner}/{run.repository_name}#
                        {run.pr_number}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="font-mono text-[11px] text-[var(--text-muted)] bg-[var(--surface-hover)] px-1.5 py-0.5 rounded border border-[var(--border)]/60">
                          {run.head_sha.slice(0, 7)}
                        </span>
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
                    <TableCell className="text-xs text-[var(--text-muted)] font-mono">
                      {formatTableDateTimeUtc(run.terminal_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        to={`/runs/${encodeURIComponent(run.run_id)}`}
                        className="inline-flex items-center px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] bg-[var(--surface-hover)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)] rounded-md transition-colors shadow-2xs"
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
      <div className="projection-metadata">
        {" "}
        <div
          suppressHydrationWarning
          className="flex items-center gap-2 mt-2 text-[11px] text-[var(--text-disabled)] font-mono"
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--text-disabled)] shrink-0" />
          <span>
            Projection cutover:
            {watermark.enabledAt
              ? ` ${formatDateTimeUtc(watermark.enabledAt)}`
              : " (watermark unavailable)"}
          </span>
          <span>&bull;</span>
          <span>
            {watermark.lastReceivedAt
              ? `Last projection: ${formatDateTimeUtc(watermark.lastReceivedAt)}`
              : "No projection received"}
          </span>
        </div>
      </div>
    </Layout>
  );
};
