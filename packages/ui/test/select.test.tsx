import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPopup,
  SelectPositioner,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "../src/components/select/select.js";

describe("Select component", () => {
  it("renders closed Select trigger with placeholder and icon", () => {
    const html = renderToStaticMarkup(
      <Select defaultValue="repo1">
        <SelectTrigger className="custom-select-trigger">
          <SelectValue placeholder="Choose a repository" />
          <SelectIcon />
        </SelectTrigger>
      </Select>,
    );

    expect(html).toContain("custom-select-trigger");
    expect(html).toContain("repo1");
    expect(html).toContain("svg");
    expect(html).toContain('role="combobox"');
  });

  it("renders SelectGroupLabel and SelectSeparator within Select and SelectGroup", () => {
    const html = renderToStaticMarkup(
      <Select>
        <SelectGroup>
          <SelectGroupLabel className="custom-group-label">
            Active Repositories
          </SelectGroupLabel>
          <SelectSeparator className="custom-separator" />
        </SelectGroup>
      </Select>,
    );

    expect(html).toContain("Active Repositories");
    expect(html).toContain("custom-group-label");
    expect(html).toContain("custom-separator");
  });

  it("executes render on SelectPositioner, SelectPopup, SelectItem, SelectItemText, SelectItemIndicator", () => {
    const posEl = (SelectPositioner as unknown as { render: Function }).render(
      { className: "test-pos" },
      null,
    );
    expect(posEl.props.className).toContain("test-pos");

    const popupEl = (SelectPopup as unknown as { render: Function }).render(
      { className: "test-popup" },
      null,
    );
    expect(popupEl.props.className).toContain("test-popup");

    const itemEl = (SelectItem as unknown as { render: Function }).render(
      { className: "test-item", value: "val1", children: "Option 1" },
      null,
    );
    expect(itemEl.props.className).toContain("test-item");

    const textEl = (SelectItemText as unknown as { render: Function }).render(
      { className: "test-text", children: "Label" },
      null,
    );
    expect(textEl.props.className).toContain("test-text");

    const indEl = (
      SelectItemIndicator as unknown as { render: Function }
    ).render({ className: "test-ind" }, null);
    expect(indEl.props.className).toContain("test-ind");
  });
});
