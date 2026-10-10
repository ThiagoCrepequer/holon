import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { expect, it, vi } from "vitest";

import { Badge } from "../src/badge.js";
import { BrandMark } from "../src/brand.js";
import { Button } from "../src/button.js";
import { Card, CardHeader, CardTitle } from "../src/card.js";
import { cn } from "../src/classes.js";
import { Dialog } from "../src/dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../src/dropdown-menu.js";
import { Icon } from "../src/icons.js";
import { InputField } from "../src/input-field.js";
import { SelectField } from "../src/select-field.js";
import { Sheet } from "../src/sheet.js";

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
  rerender(<Button aria-busy="true">Save</Button>);
  expect(button).toHaveAttribute("aria-busy", "true");
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

it("input fields own accessible description, invalid state and native editing for every caller", async () => {
  const user = userEvent.setup();
  const changed = vi.fn();
  const { rerender } = render(
    <InputField label="Recipient" type="email" onChange={changed} />,
  );
  const input = screen.getByRole("textbox", { name: "Recipient" });
  await user.type(input, "person@example.invalid");
  expect(input).toHaveValue("person@example.invalid");
  expect(changed).toHaveBeenCalled();
  expect(input).not.toHaveAttribute("aria-invalid");
  rerender(
    <InputField
      id="recipient"
      label="Recipient"
      type="email"
      hint="Use a verified email"
      error="<script>"
      aria-describedby="additional"
      disabled
    />,
  );
  expect(input).toHaveAttribute(
    "aria-describedby",
    "additional recipient-hint recipient-error",
  );
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input).toBeDisabled();
  expect(document.querySelector("script")).toBeNull();
});

it("cards preserve product headings and badge text instead of using color as the only status", () => {
  render(
    <Card aria-label="Current workspace" className="p-4">
      <CardHeader className="mb-2">
        <CardTitle>Repositories</CardTitle>
        <Badge>Pending</Badge>
        <Badge tone="success" className="px-4">
          Completed
        </Badge>
      </CardHeader>
    </Card>,
  );
  expect(screen.getByRole("region", { name: "Current workspace" })).toHaveClass(
    "p-4",
  );
  expect(
    screen.getByRole("heading", { level: 2, name: "Repositories" }),
  ).toBeVisible();
  expect(screen.getByText("Pending")).toBeVisible();
  expect(screen.getByText("Completed")).toHaveClass("px-4");
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

it("Sheet shares native dismissal and treats only backdrop clicks as outside interaction", () => {
  const changed = vi.fn();
  render(
    <Sheet
      open
      onOpenChange={changed}
      returnFocusRef={createRef<HTMLButtonElement>()}
      title="Create workspace"
      description="Team details"
      closeLabel="Close"
    >
      <button>Inside</button>
    </Sheet>,
  );
  const sheet = screen.getByRole("dialog", { name: "Create workspace" });
  expect(sheet).toHaveClass("holon-sheet");
  fireEvent.click(screen.getByRole("button", { name: "Inside" }));
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(sheet, { clientX: 0, clientY: 0 });
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(sheet, { clientX: 10, clientY: 10 });
  expect(changed).toHaveBeenLastCalledWith(false);
});

it("Base UI menus preserve named triggers, radio selection and item activation", async () => {
  const selected = vi.fn();
  const clicked = vi.fn();
  const user = userEvent.setup();
  render(
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button />}>Workspace</DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="p-2">
        <DropdownMenuRadioGroup
          defaultValue="personal"
          onValueChange={selected}
        >
          <DropdownMenuRadioItem value="personal">
            Personal
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="team" className="px-4">
            Team
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={clicked} className="gap-4">
          Create
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  const trigger = screen.getByRole("button", { name: "Workspace" });
  await user.click(trigger);
  expect(
    await screen.findByRole("menuitemradio", { name: "Personal" }),
  ).toHaveAttribute("aria-checked", "true");
  await user.click(screen.getByRole("menuitemradio", { name: "Team" }));
  expect(selected).toHaveBeenCalledWith("team", expect.anything());
  await waitFor(() =>
    expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
  );
  await user.click(trigger);
  await user.click(await screen.findByRole("menuitem", { name: "Create" }));
  expect(clicked).toHaveBeenCalledTimes(1);
});
