import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EmptyState } from "../src/components/empty-state/empty-state.js";

describe("EmptyState component", () => {
  it("renders with title and description", () => {
    const html = renderToStaticMarkup(
      <EmptyState
        title="No items found"
        description="Try adjusting your search criteria"
        icon={<span>🔍</span>}
        action={<button type="button">Reset</button>}
      />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("No items found");
    expect(html).toContain("Try adjusting your search criteria");
    expect(html).toContain("🔍");
    expect(html).toContain("Reset");
  });

  it("renders with minimal props", () => {
    const html = renderToStaticMarkup(<EmptyState title="Nothing here" />);
    expect(html).toContain("Nothing here");
  });
});
