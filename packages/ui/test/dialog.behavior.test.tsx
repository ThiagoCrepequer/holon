/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it } from "vitest";

import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../src/index.js";

describe("Dialog behavioral accessibility", () => {
  it("opens, moves focus, closes and has no automatic Axe violations", async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Inspect run</DialogTrigger>
        <DialogPopup>
          <DialogTitle>Run details</DialogTitle>
          <DialogDescription>
            Operational details for this run.
          </DialogDescription>
          <DialogClose>Close details</DialogClose>
        </DialogPopup>
      </Dialog>,
    );

    const trigger = screen.getByRole("button", { name: "Inspect run" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Run details" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(
      (
        await axe.run(document.body, {
          rules: { "color-contrast": { enabled: false } },
        })
      ).violations,
    ).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Close details" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
