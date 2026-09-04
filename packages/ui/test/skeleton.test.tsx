import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Skeleton } from "../src/components/skeleton/skeleton.js";

describe("Skeleton component", () => {
  it("renders default skeleton", () => {
    const html = renderToStaticMarkup(<Skeleton className="w-20 h-4" />);
    expect(html).toContain("animate-pulse");
    expect(html).toContain("rounded-md");
    expect(html).toContain('aria-hidden="true"');
  });

  it("renders circle skeleton", () => {
    const html = renderToStaticMarkup(
      <Skeleton variant="circle" className="w-8 h-8" />,
    );
    expect(html).toContain("rounded-full");
  });

  it("renders text skeleton", () => {
    const html = renderToStaticMarkup(<Skeleton variant="text" />);
    expect(html).toContain("h-4 rounded");
  });
});
