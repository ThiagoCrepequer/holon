import type { AdminRunDetailV1 } from "@holon/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { NotFoundView } from "../app/routes/not-found.js";
import { DashboardView } from "../app/views/dashboard-view.js";
import { ReadinessView } from "../app/views/readiness-view.js";
import { RunDetailView } from "../app/views/run-detail-view.js";
import { RunsView } from "../app/views/runs-view.js";
import type { AdminRunRow, AdminSummaryMetrics } from "../workers/types.js";

const baseRun: AdminRunRow = {
  analysis_started_at: "2026-09-04T11:00:02.000Z",
  estimated_cost_micro_usd: 1234,
  execution_duration_ms: 2_000,
  head_sha: "a".repeat(40),
  input_tokens: 10,
  is_degraded: 0,
  output_tokens: 5,
  payload_hash: "b".repeat(64),
  pr_key: "github:42:pr:7",
  pr_number: 7,
  pricing_model: "test-model",
  projected_at: "2026-09-04T11:00:06.000Z",
  projected_at_epoch_ms: 1_788_519_606_000,
  projection_delivery_lag_ms: 1_000,
  projection_requested_at: "2026-09-04T11:00:05.000Z",
  record_version: 1,
  repository_id: 42,
  repository_name: "holon",
  repository_owner: "acme",
  review_admission_wait_ms: 100,
  review_phase_reached: "publishing",
  reasoning_tokens: 2,
  run_id: `github:42:pr:7:head:${"a".repeat(40)}`,
  schema_version: 1,
  scope_status: "complete",
  shards_count: 1,
  source_event_id: "event-1",
  terminal_at: "2026-09-04T11:00:05.000Z",
  terminal_at_epoch_ms: 1_788_519_605_000,
  terminal_state: "completed",
  tool_calls_count: 1,
  verdict: "APPROVE",
  webhook_received_at: "2026-09-04T11:00:00.000Z",
  workflow_started_at: "2026-09-04T11:00:01.000Z",
};

const runVariants: AdminRunRow[] = [
  baseRun,
  {
    ...baseRun,
    execution_duration_ms: 0,
    run_id: `github:42:pr:8:head:${"b".repeat(40)}`,
    terminal_state: "failed_terminal",
    verdict: "REQUEST_CHANGES",
  },
  {
    ...baseRun,
    run_id: `github:42:pr:9:head:${"c".repeat(40)}`,
    terminal_state: "obsolete",
    verdict: "COMMENT",
  },
  {
    ...baseRun,
    run_id: `github:42:pr:10:head:${"d".repeat(40)}`,
    scope_status: null,
    verdict: null,
  },
];

const baseSummary: AdminSummaryMetrics = {
  averageExecutionDurationMs: 2_000,
  completedRuns: 10,
  failedTerminalRuns: 0,
  obsoleteRuns: 0,
  successRatePercentage: 100,
  totalEstimatedCostMicroUsd: 1234,
  totalInputTokens: 10,
  totalOutputTokens: 5,
  totalReasoningTokens: 2,
  totalRuns: 10,
  totalTokens: 17,
  verdictDistribution: { approve: 8, comment: 1, requestChanges: 1 },
};

const detail: AdminRunDetailV1 = {
  currentFindings: [
    {
      diagnostic: "Critical diagnostic",
      filePath: "src/a.ts",
      fingerprint: `fp:${"a".repeat(64)}`,
      line: 1,
      severity: "critical",
      status: "new",
      updatedAt: "2026-09-04T11:00:05.000Z",
    },
    {
      diagnostic: "High diagnostic",
      filePath: "src/b.ts",
      fingerprint: `fp:${"b".repeat(64)}`,
      line: 2,
      severity: "high",
      status: "resolved",
      updatedAt: "2026-09-04T11:00:05.000Z",
    },
    {
      diagnostic: "Low diagnostic",
      filePath: "src/c.ts",
      fingerprint: `fp:${"c".repeat(64)}`,
      line: 3,
      severity: "low",
      status: "dismissed",
      updatedAt: "2026-09-04T11:00:05.000Z",
    },
  ],
  findingsPerspective: "current_pr_state",
  run: {
    cost: {
      currency: "USD",
      estimatedCostMicroUsd: 1234,
      estimatedCostUsd: 0.001234,
      pricingModel: "test-model",
    },
    headSha: "a".repeat(40),
    isDegraded: false,
    prKey: "github:42:pr:7",
    runId: baseRun.run_id as AdminRunDetailV1["run"]["runId"],
    scopeStatus: "complete",
    shardsCount: 1,
    stepTimings: [],
    terminalState: "completed",
    tokens: {
      inputTokens: 10,
      outputTokens: 5,
      reasoningTokens: 2,
      totalTokens: 17,
    },
    toolCallsCount: 1,
    verdict: "APPROVE",
  },
  schemaVersion: 1,
  structuredCi: {
    durationMs: 1_000,
    failed: 0,
    passed: 2,
    skipped: 0,
    status: "available",
    total: 2,
    workflowName: "CI",
  },
};

function render(element: React.ReactNode, location = "/") {
  return renderToStaticMarkup(
    <StaticRouter location={location}>{element}</StaticRouter>,
  );
}

describe("admin views", () => {
  it("renders dashboard states and every run badge variant", () => {
    const healthy = render(
      <DashboardView
        analyticsTrend={null}
        degradedServices={["Queue Pipeline"]}
        queueHealth={{
          backlogCount: 3,
          dlqCount: 1,
          isDegraded: true,
          oldestMessageAgeSeconds: 400,
        }}
        recentRuns={runVariants}
        summary={baseSummary}
        userEmail="operator@example.com"
        watermark={{
          enabledAt: "2026-09-04T11:00:00.000Z",
          lastReceivedAt: "2026-09-04T11:00:06.000Z",
        }}
        window="24h"
      />,
    );
    expect(healthy).toContain("Oldest Message:");
    expect(healthy).toContain("400s");
    expect(healthy).toContain("Operational Degradation Detected");

    const warning = render(
      <DashboardView
        analyticsTrend={null}
        degradedServices={["Analytics Engine"]}
        queueHealth={{ backlogCount: 0, dlqCount: 0, isDegraded: false }}
        recentRuns={[]}
        summary={{
          ...baseSummary,
          averageExecutionDurationMs: 0,
          completedRuns: 8,
        }}
        watermark={{ enabledAt: null, lastReceivedAt: null }}
        window="7d"
      />,
    );
    expect(warning).toContain("No review runs recorded");
    expect(warning).toContain("watermark unavailable");

    const empty = render(
      <DashboardView
        analyticsTrend={null}
        degradedServices={[]}
        queueHealth={null}
        recentRuns={[]}
        summary={{ ...baseSummary, completedRuns: 0, totalRuns: 0 }}
        watermark={{ enabledAt: null, lastReceivedAt: null }}
        window="30d"
      />,
    );
    expect(empty).toContain("0%");
  });

  it("renders filtered, empty and paginated run listings", () => {
    const populated = render(
      <RunsView
        nextCursor="next-cursor"
        order="asc"
        pageSize={20}
        period="30d"
        repositoryId={42}
        runs={runVariants}
        searchQuery="acme/holon#7"
        terminalState="completed"
        verdict="APPROVE"
      />,
      "/runs",
    );
    expect(populated).toContain("Next Page");
    expect(populated).toContain("repositoryId=42");

    const unfilteredEmpty = render(<RunsView runs={[]} />, "/runs");
    expect(unfilteredEmpty).toContain("No runs in this time window");

    const filteredEmpty = render(
      <RunsView repositoryId={99} runs={[]} />,
      "/runs",
    );
    expect(filteredEmpty).toContain("No matching runs found");
    expect(filteredEmpty).toContain("Reset all filters");
  });

  it("renders run detail fallbacks, findings, CI and embedded SSR", () => {
    const complete = render(
      <RunDetailView
        rpcDetail={detail}
        rpcError="timeout"
        run={baseRun}
        userEmail="operator@example.com"
      />,
      `/runs/${encodeURIComponent(baseRun.run_id)}`,
    );
    expect(complete).toContain("Critical diagnostic");
    expect(complete).toContain("Continuous Integration Evidence");
    expect(complete).toContain("RPC Drill-down degraded");

    const embedded = render(
      <RunDetailView
        embedded
        rpcDetail={{ ...detail, currentFindings: [], structuredCi: null }}
        run={{ ...runVariants[1]!, pricing_model: "", scope_status: null }}
      />,
      "/runs",
    );
    expect(embedded).toContain("No findings emitted");

    for (const run of runVariants.slice(1)) {
      expect(
        render(<RunDetailView rpcDetail={null} run={run} />, "/runs/x"),
      ).toContain("No findings emitted");
    }

    const ciWithoutName = render(
      <RunDetailView
        rpcDetail={{
          ...detail,
          structuredCi: {
            ...detail.structuredCi!,
            status: "not_available",
            workflowName: null,
          },
        }}
        run={baseRun}
      />,
      "/runs/x",
    );
    expect(ciWithoutName).toContain("not_available");
  });

  it("renders every readiness status and criticality", () => {
    for (const status of ["healthy", "degraded", "partial"] as const) {
      const componentStatus = status === "partial" ? "unknown" : status;
      const html = render(
        <ReadinessView
          report={{
            checks: {
              analyticsEngine: componentStatus,
              d1: componentStatus,
              queueMetrics: componentStatus,
              rpc: componentStatus,
            },
            status,
            timestamp: "2026-09-04T11:00:00.000Z",
          }}
        />,
        "/readiness",
      );
      expect(html).toContain(status.toUpperCase());
      expect(html).toContain("Required");
      expect(html).toContain("Optional");
    }
  });

  it("renders the catch-all page", () => {
    expect(render(<NotFoundView />, "/missing")).toContain("Page not found");
  });
});
