/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
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
  SelectField,
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

  it("renders SelectField with options, label, custom chevron, and error state", () => {
    const options = [
      { value: "opt1", label: "Option 1" },
      { value: "opt2", label: "Option 2", disabled: true },
    ];

    const normalHtml = renderToStaticMarkup(
      <SelectField
        id="test-select"
        label="Test Label"
        name="testName"
        defaultValue="opt1"
        options={options}
      />,
    );

    expect(normalHtml).toContain('role="combobox"');
    expect(normalHtml).toContain("<button");
    expect(normalHtml).toContain("<input");
    expect(normalHtml).not.toContain("<select");
    expect(normalHtml).toContain('id="test-select"');
    expect(normalHtml).toContain('name="testName"');
    expect(normalHtml).toContain("Test Label");
    expect(normalHtml).toContain("Option 1");
    expect(normalHtml).toContain('value="opt1"');
    expect(normalHtml).toContain("<svg");
    expect(normalHtml).not.toContain("aria-invalid");

    const errorHtml = renderToStaticMarkup(
      <SelectField
        id="err-select"
        options={options}
        error="Selection is required"
      />,
    );

    expect(errorHtml).toContain('aria-invalid="true"');
    expect(errorHtml).toContain("Selection is required");
    expect(errorHtml).toContain("border-[var(--danger)]");
  });

  it("supports placeholder without defaultValue and forwards ref to trigger", () => {
    const options = [
      { value: "opt1", label: "Option 1" },
      { value: "opt2", label: "Option 2" },
    ];

    const ref = React.createRef<HTMLButtonElement>();
    const html = renderToStaticMarkup(
      <SelectField
        ref={ref}
        id="ph-select"
        options={options}
        placeholder="Choose an option"
      />,
    );

    expect(html).toContain("Choose an option");
    expect(html).toContain('id="ph-select"');
  });

  it("handles onValueChange and autoSubmit with user interaction", async () => {
    const options = [
      { value: "opt1", label: "Option 1" },
      { value: "opt2", label: "Option 2" },
    ];

    let receivedValue = "";
    let formSubmitted = false;

    const ref = React.createRef<HTMLButtonElement>();

    const { unmount } = render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          formSubmitted = true;
        }}
      >
        <SelectField
          ref={ref}
          options={options}
          defaultValue="opt1"
          autoSubmit
          onValueChange={(val) => {
            receivedValue = val ?? "";
          }}
        />
      </form>,
    );

    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    const trigger = screen.getByRole("combobox");
    expect(trigger).toBeDefined();

    // Trigger popup display via click
    trigger.click();
    const option2 = await screen.findByRole(
      "option",
      { name: "Option 2" },
      { timeout: 8000 },
    );
    expect(option2).toBeDefined();

    option2.click();
    expect(receivedValue).toBe("opt2");
    expect(formSubmitted).toBe(true);

    unmount();
  }, 15000);
});
