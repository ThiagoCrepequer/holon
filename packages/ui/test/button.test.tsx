import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Button,
  type ButtonSize,
  type ButtonVariant,
} from "../src/components/button/button.js";
import { IconButton } from "../src/components/button/icon-button.js";

describe("Button and IconButton components", () => {
  it("renders default medium button", () => {
    const html = renderToStaticMarkup(<Button>Click Me</Button>);
    expect(html).toContain("Click Me");
    expect(html).toContain('type="button"');
    expect(html).toContain("bg-[var(--accent)]");
    expect(html).toContain("h-9 px-4 text-sm");
  });

  it("renders all button variants", () => {
    const variants: ButtonVariant[] = [
      "default",
      "secondary",
      "outline",
      "ghost",
      "danger",
    ];
    for (const variant of variants) {
      const html = renderToStaticMarkup(
        <Button variant={variant}>{variant}</Button>,
      );
      expect(html).toContain(variant);
    }
  });

  it("renders all button sizes", () => {
    const sizes: ButtonSize[] = ["sm", "md", "lg"];
    for (const size of sizes) {
      const html = renderToStaticMarkup(
        <Button size={size}>Size {size}</Button>,
      );
      expect(html).toContain(`Size ${size}`);
    }
  });

  it("handles loading state", () => {
    const html = renderToStaticMarkup(<Button loading>Submit</Button>);
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("animate-spin");
  });

  it("handles disabled state without loading", () => {
    const html = renderToStaticMarkup(<Button disabled>Disabled</Button>);
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('aria-busy="true"');
    expect(html).not.toContain("animate-spin");
  });

  it("renders IconButton with aria-label", () => {
    const html = renderToStaticMarkup(
      <IconButton aria-label="Close dialog" size="sm">
        <span>X</span>
      </IconButton>,
    );
    expect(html).toContain('aria-label="Close dialog"');
    expect(html).toContain("w-8 h-8 p-0");
    expect(html).toContain("<span>X</span>");
  });

  it("renders IconButton with different sizes", () => {
    const sm = renderToStaticMarkup(
      <IconButton aria-label="sm" size="sm">
        <span>1</span>
      </IconButton>,
    );
    const md = renderToStaticMarkup(
      <IconButton aria-label="md" size="md">
        <span>2</span>
      </IconButton>,
    );
    const lg = renderToStaticMarkup(
      <IconButton aria-label="lg" size="lg">
        <span>3</span>
      </IconButton>,
    );
    expect(sm).toContain("w-8 h-8");
    expect(md).toContain("w-9 h-9");
    expect(lg).toContain("w-11 h-11");
  });
});
