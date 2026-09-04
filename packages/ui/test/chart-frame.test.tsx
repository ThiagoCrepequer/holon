import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChartFrame } from "../src/components/chart-frame/chart-frame.js";

describe("ChartFrame component", () => {
  it("renders standard chart frame with title, description, insight, and table toggle", () => {
    const handleToggle = vi.fn();
    const html = renderToStaticMarkup(
      <ChartFrame
        title="Execution Time Trend"
        description="p50 and p95 latency over the last 24 hours"
        insight="Median latency improved by 14%"
        accessibleTable={
          <table>
            <tbody>
              <tr>
                <td>Row 1</td>
              </tr>
            </tbody>
          </table>
        }
        onToggleTable={handleToggle}
      >
        <div id="recharts-mock">Chart graphic</div>
      </ChartFrame>,
    );

    expect(html).toContain("Execution Time Trend");
    expect(html).toContain("p50 and p95 latency over the last 24 hours");
    expect(html).toContain("Median latency improved by 14%");
    expect(html).toContain("View data table");
    expect(html).toContain("Chart graphic");
    expect(html).toContain('role="region"');
  });

  it("renders table view when showTable is true", () => {
    const handleToggle = vi.fn();
    const html = renderToStaticMarkup(
      <ChartFrame
        title="Table View Active"
        showTable={true}
        accessibleTable={
          <table id="accessible-data">
            <tbody>
              <tr>
                <td>Data 42</td>
              </tr>
            </tbody>
          </table>
        }
        onToggleTable={handleToggle}
      >
        <div>Chart hidden</div>
      </ChartFrame>,
    );

    expect(html).toContain("accessible-data");
    expect(html).toContain("Data 42");
    expect(html).toContain("View chart");
    expect(html).not.toContain("Chart hidden");
  });

  it("renders loading state", () => {
    const html = renderToStaticMarkup(
      <ChartFrame title="Loading Chart" loading>
        <div>Content</div>
      </ChartFrame>,
    );

    expect(html).toContain("Loading chart...");
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("Content");
  });

  it("renders empty state", () => {
    const html = renderToStaticMarkup(
      <ChartFrame
        title="Empty Chart"
        empty
        emptyMessage="No telemetry data recorded"
      >
        <div>Content</div>
      </ChartFrame>,
    );

    expect(html).toContain("No telemetry data recorded");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("Content");
  });
});
