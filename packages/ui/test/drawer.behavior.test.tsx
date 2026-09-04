/** @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";

import {
  Drawer,
  DrawerClose,
  DrawerPopup,
  DrawerTitle,
} from "../src/components/drawer/drawer.js";

it("exposes the entrance animation state when mounted already open and preserves keyboard dismissal", async () => {
  const user = userEvent.setup();
  const view = render(
    <Drawer defaultOpen>
      <DrawerPopup>
        <DrawerTitle>Run detail</DrawerTitle>
        <DrawerClose>Close</DrawerClose>
      </DrawerPopup>
    </Drawer>,
  );
  try {
    const dialog = await screen.findByRole("dialog", { name: "Run detail" });
    await waitFor(() => {
      expect(dialog.classList.contains("drawer-popup")).toBe(true);
      expect(dialog.hasAttribute("data-open")).toBe(true);
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  } finally {
    view.unmount();
  }
});
