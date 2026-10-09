import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { expect, it, vi } from "vitest";

import { BrandMark } from "../src/brand.js";
import { Button } from "../src/button.js";
import { cn } from "../src/classes.js";
import { Dialog } from "../src/dialog.js";
import { Icon } from "../src/icons.js";
import { SelectField } from "../src/select-field.js";

it("buttons preserve labels, native semantics and reject repeat actions while busy/disabled", async () => {
  const clicked = vi.fn();
  const user = userEvent.setup();
  const { rerender } = render(<Button onClick={clicked}>Save</Button>);
  const button = screen.getByRole("button", { name: "Save" });
  expect(button).toHaveAttribute("type", "button");
  await user.tab();
  expect(button).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(clicked).toHaveBeenCalledTimes(1);
  rerender(
    <Button busy onClick={clicked}>
      Save
    </Button>,
  );
  expect(button).toHaveAttribute("aria-busy", "true");
  await user.click(button);
  expect(clicked).toHaveBeenCalledTimes(1);
  rerender(
    <Button disabled variant="danger" type="submit">
      Save
    </Button>,
  );
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("type", "submit");
  for (const variant of ["quiet", "secondary", "primary"] as const) {
    rerender(
      <Button variant={variant} className="gap-4">
        Save
      </Button>,
    );
    expect(button).toHaveClass(`holon-button-${variant}`, "gap-4");
  }
  expect(cn("gap-2", undefined, { "gap-4": true })).toBe("gap-4");
  expect(cn()).toBe("");
});
it("icons are decorative unless named and the official brand has a single accessible name", () => {
  const { rerender } = render(
    <>
      <Icon name="settings" />
      <BrandMark />
    </>,
  );
  expect(screen.getAllByRole("img")).toHaveLength(1);
  expect(screen.getByRole("img", { name: "Holon" })).toBeInTheDocument();
  rerender(
    <>
      <Icon name="close" label="Close" />
      <BrandMark decorative />
      <Icon name="arrowRight" />
    </>,
  );
  expect(screen.getAllByRole("img")).toHaveLength(1);
  expect(screen.getByRole("img", { name: "Close" })).toHaveAttribute(
    "stroke-width",
    "1.75",
  );
});
it("select fields connect names, hints and errors while preserving selection and hostile text as text", async () => {
  const user = userEvent.setup();
  const changed = vi.fn();
  const { rerender } = render(
    <SelectField
      label="Language"
      options={[
        { value: "en", label: "English" },
        { value: "pt-BR", label: "Português" },
      ]}
      defaultValue="en"
      onChange={changed}
    />,
  );
  const select = screen.getByRole("combobox", { name: "Language" });
  await user.selectOptions(select, "pt-BR");
  expect(select).toHaveValue("pt-BR");
  expect(changed).toHaveBeenCalledTimes(1);
  rerender(
    <SelectField
      id="language"
      label="Language"
      hint="Choose a language"
      error="<img onerror=alert(1)>"
      aria-describedby="extra"
      options={[{ value: "en", label: "English" }]}
      disabled
    />,
  );
  expect(select).toHaveAttribute("aria-invalid", "true");
  expect(select).toHaveAttribute(
    "aria-describedby",
    "extra language-hint language-error",
  );
  expect(select).toBeDisabled();
  expect(screen.getByText("<img onerror=alert(1)>")).toBeInTheDocument();
  expect(document.querySelector("img")).toBeNull();
});
it("dialog synchronizes its controlled state and communicates dismissal without altering content", async () => {
  const changed = vi.fn();
  const user = userEvent.setup();
  const props = {
    returnFocusRef: createRef<HTMLButtonElement>(),
    onOpenChange: changed,
    title: "Preferences",
    description: "Choose language",
    closeLabel: "Close",
    children: <button>Keep content</button>,
  };
  const { rerender } = render(<Dialog {...props} open={false} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  rerender(<Dialog {...props} open />);
  const dialog = screen.getByRole("dialog", { name: "Preferences" });
  expect(dialog).toHaveAccessibleDescription("Choose language");
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(changed).toHaveBeenLastCalledWith(false);
  const cancelled = new Event("cancel", { cancelable: true });
  fireEvent(dialog, cancelled);
  expect(cancelled.defaultPrevented).toBe(true);
  fireEvent(dialog, new Event("close"));
  expect(changed).toHaveBeenLastCalledWith(false);
  rerender(<Dialog {...props} open={false} />);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("a queued close event cannot dismiss a dialog that was reopened", () => {
  const changed = vi.fn();
  const props = {
    returnFocusRef: createRef<HTMLButtonElement>(),
    onOpenChange: changed,
    title: "Review",
    description: "Evidence",
    closeLabel: "Close",
    children: "content",
  };
  const { rerender } = render(<Dialog {...props} open />);
  const dialog = screen.getByRole("dialog");
  rerender(<Dialog {...props} open={false} />);
  rerender(<Dialog {...props} open />);
  changed.mockClear();
  fireEvent(dialog, new Event("close"));
  expect(changed).not.toHaveBeenCalled();
});

it("dialog restores its explicit trigger after dismissal and unmount even when pointer activation did not focus it", () => {
  const trigger = createRef<HTMLButtonElement>();
  const props = {
    returnFocusRef: trigger,
    onOpenChange: vi.fn(),
    title: "Preferences",
    description: "Choose language",
    closeLabel: "Close",
    children: "content",
  };
  const view = (open: boolean, mounted = true) => (
    <>
      <button ref={trigger}>Open preferences</button>
      <button>Other control</button>
      {mounted && <Dialog {...props} open={open} />}
    </>
  );
  const { rerender } = render(view(false));
  screen.getByRole("button", { name: "Other control" }).focus();
  rerender(view(true));
  rerender(view(false));
  expect(trigger.current).toHaveFocus();
  rerender(view(true));
  screen.getByRole("button", { name: "Other control" }).focus();
  rerender(view(false, false));
  expect(trigger.current).toHaveFocus();
});
