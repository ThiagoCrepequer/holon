import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../src/components/card/card.js";
import {
  MetricCard,
  type MetricTone,
} from "../src/components/card/metric-card.js";

describe("Card and MetricCard components", () => {
  it("renders basic Card with subcomponents", () => {
    const html = renderToStaticMarkup(
      <Card className="custom-card">
        <CardHeader>
          <CardTitle>Test Title</CardTitle>
          <CardDescription>Test Description</CardDescription>
        </CardHeader>
        <CardContent>Body Content</CardContent>
        <CardFooter>Footer Content</CardFooter>
      </Card>,
    );

    expect(html).toContain("custom-card");
    expect(html).toContain("Test Title");
    expect(html).toContain("Test Description");
    expect(html).toContain("Body Content");
    expect(html).toContain("Footer Content");
  });

  it("renders MetricCard with value, subtitle and tones", () => {
    const tones: MetricTone[] = [
      "neutral",
      "success",
      "warning",
      "danger",
      "info",
    ];
    for (const tone of tones) {
      const html = renderToStaticMarkup(
        <MetricCard
          label="Total Runs"
          value="1,240"
          subtitle="+12% from last week"
          tone={tone}
          icon={<span>📊</span>}
        />,
      );
      expect(html).toContain("Total Runs");
      expect(html).toContain("1,240");
      expect(html).toContain("+12% from last week");
      expect(html).toContain("📊");
    }
  });

  it("renders MetricCard loading skeleton when loading is true", () => {
    const html = renderToStaticMarkup(
      <MetricCard
        label="Pending Reviews"
        value="42"
        subtitle="Active now"
        loading
      />,
    );
    expect(html).toContain("Pending Reviews");
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("42");
  });
});
