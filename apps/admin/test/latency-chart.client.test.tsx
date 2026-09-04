import { fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("recharts", () => ({
  CartesianGrid: () => <div data-testid="grid" />,
  Line: ({ name }: { name: string }) => <div>{name}</div>,
  LineChart: ({ children }: PropsWithChildren) => <div>{children}</div>,
  ResponsiveContainer: ({ children }: PropsWithChildren) => (
    <div>{children}</div>
  ),
  Tooltip: () => <div data-testid="tooltip" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
}));

import LatencyChartClient, {
  formatBucketTick,
  formatPreciseDuration,
  formatRoundedDuration,
} from "../app/components/latency-chart.client.js";

describe("LatencyChartClient", () => {
  it("renders the unavailable state without a visual chart", () => {
    render(<LatencyChartClient trend={null} />);

    expect(
      screen.getByText(
        "Analytics Engine latency data is currently unavailable",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("renders a visual trend and an exact accessible table", () => {
    render(
      <LatencyChartClient
        trend={{
          p50DurationMs: 1_250,
          p95DurationMs: 2_500,
          points: [
            {
              bucket: "2026-09-04T11:00:00Z",
              p50DurationMs: 1_250,
              p95DurationMs: 2_500,
              sampledRunsCount: 4,
            },
          ],
          sampledRunsCount: 4,
          window: "24h",
        }}
      />,
    );

    expect(
      screen.getByRole("img", { name: /latency trend chart/i }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View data table" }));
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("1.25s")).toBeTruthy();
    expect(screen.getByText("2.50s")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View chart" }));
    expect(
      screen.getByRole("img", { name: /latency trend chart/i }),
    ).toBeTruthy();
  });

  it("formats axis and tooltip values deterministically", () => {
    expect(formatBucketTick("2026-09-04T11:00:00Z")).toBe("09-04T11:00");
    expect(formatRoundedDuration(1_501)).toBe("2s");
    expect(formatPreciseDuration(1_501)).toBe("1.50s");
  });
});
