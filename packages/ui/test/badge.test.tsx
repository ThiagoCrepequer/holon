import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Badge,
  type BadgeVariant,
  type BadgeSize,
} from "../src/components/badge/badge.js";

describe("Badge component", () => {
  it("renders default neutral small badge", () => {
    const html = renderToStaticMarkup(<Badge>Neutral</Badge>);
    expect(html).toContain("Neutral");
    expect(html).toContain("bg-[var(--surface-hover)]");
    expect(html).toContain("px-2 py-0.5 text-xs");
  });

  it("renders all variants correctly", () => {
    const variants: BadgeVariant[] = [
      "neutral",
      "success",
      "warning",
      "danger",
      "info",
    ];
    for (const variant of variants) {
      const html = renderToStaticMarkup(
        <Badge variant={variant}>{variant}</Badge>,
      );
      expect(html).toContain(variant);
    }
  });

  it("renders sizes correctly", () => {
    const sizes: BadgeSize[] = ["sm", "md"];
    for (const size of sizes) {
      const html = renderToStaticMarkup(<Badge size={size}>Size {size}</Badge>);
      expect(html).toContain(`Size ${size}`);
    }
  });

  it("renders dot indicator when dot is true", () => {
    const withDot = renderToStaticMarkup(
      <Badge dot variant="success">
        Active
      </Badge>,
    );
    expect(withDot).toContain('aria-hidden="true"');
    expect(withDot).toContain("w-1.5 h-1.5 rounded-full");
    expect(withDot).toContain("bg-[var(--success)]");

    const withoutDot = renderToStaticMarkup(<Badge dot={false}>Active</Badge>);
    expect(withoutDot).not.toContain("w-1.5 h-1.5 rounded-full");
  });

  it("supports custom className", () => {
    const html = renderToStaticMarkup(
      <Badge className="custom-test-class">Test</Badge>,
    );
    expect(html).toContain("custom-test-class");
  });
});
