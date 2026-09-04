import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import {
  DashboardView,
  type DashboardViewProps,
} from "../app/views/dashboard-view.js";

const empty: DashboardViewProps = {
  window: "24h",
  analyticsTrend: null,
  queueHealth: null,
  recentRuns: [],
  operationalNotices: [],
  watermark: { enabledAt: null, lastReceivedAt: null },
  summary: {
    averageExecutionDurationMs: 0,
    completedRuns: 0,
    failedTerminalRuns: 0,
    obsoleteRuns: 0,
    successRatePercentage: 0,
    totalEstimatedCostMicroUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalReasoningTokens: 0,
    totalRuns: 0,
    totalTokens: 0,
    verdictDistribution: { approve: 0, comment: 0, requestChanges: 0 },
  },
};
afterEach(cleanup);
function show(props: DashboardViewProps) {
  render(
    <MemoryRouter>
      <DashboardView {...props} />
    </MemoryRouter>,
  );
}

describe("dashboard metric meaning", () => {
  it("distinguishes an empty period from a zero percent success rate", () => {
    show(empty);
    const success = within(screen.getByRole("group", { name: "Success Rate" }));
    expect(success.getByText("—")).toBeTruthy();
    expect(success.queryByText("0%")).toBeNull();
    expect(
      within(screen.getByRole("group", { name: "Total Runs" })).getByText("0"),
    ).toBeTruthy();
    expect(screen.getByText("No verdicts in this period")).toBeTruthy();
    expect(
      screen.getByText(
        "Analytics Engine latency data is currently unavailable",
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Loading latency chart")).toBeNull();
  });
  it("keeps a real zero success rate distinct from missing data", () => {
    show({
      ...empty,
      summary: {
        ...empty.summary,
        totalRuns: 4,
        failedTerminalRuns: 4,
        averageExecutionDurationMs: 1500,
      },
    });
    expect(
      within(screen.getByRole("group", { name: "Success Rate" })).getByText(
        "0%",
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("group", { name: "Avg Duration" })).getByText(
        "1.5s",
      ),
    ).toBeTruthy();
  });
});

describe("latency availability", () => {
  it("identifies an available integration with no samples as an empty period", () => {
    show({
      ...empty,
      analyticsTrend: {
        window: "24h",
        points: [],
        p50DurationMs: 0,
        p95DurationMs: 0,
        sampledRunsCount: 0,
      },
    });
    expect(screen.getByText("No latency samples")).toBeTruthy();
    expect(
      screen.queryByText(
        "Analytics Engine latency data is currently unavailable",
      ),
    ).toBeNull();
  });
});
