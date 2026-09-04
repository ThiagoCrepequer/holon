import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../src/components/dialog/dialog.js";

describe("Dialog component", () => {
  it("renders trigger element", () => {
    const html = renderToStaticMarkup(
      <Dialog>
        <DialogTrigger>Open Modal</DialogTrigger>
      </Dialog>,
    );
    expect(html).toContain("Open Modal");
  });

  it("renders dialog header, title, description, footer, and close within Dialog root", () => {
    const html = renderToStaticMarkup(
      <Dialog>
        <DialogHeader className="custom-header">
          <DialogTitle className="custom-title">Confirm Action</DialogTitle>
          <DialogDescription className="custom-desc">
            Are you sure you want to proceed?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="custom-footer">
          <DialogClose>Cancel</DialogClose>
        </DialogFooter>
      </Dialog>,
    );

    expect(html).toContain("custom-header");
    expect(html).toContain("custom-title");
    expect(html).toContain("Confirm Action");
    expect(html).toContain("custom-desc");
    expect(html).toContain("Are you sure you want to proceed?");
    expect(html).toContain("custom-footer");
    expect(html).toContain("Cancel");
  });

  it("executes render on DialogBackdrop and DialogPopup", () => {
    const backdropEl = (
      DialogBackdrop as unknown as { render: Function }
    ).render({ className: "test-backdrop" }, null);
    expect(backdropEl.props.className).toContain("test-backdrop");
    expect(backdropEl.props.className).toContain("fixed inset-0");

    const popupEl = (DialogPopup as unknown as { render: Function }).render(
      { className: "test-popup", children: "Modal Body" },
      null,
    );
    expect(popupEl).toBeDefined();
  });
});
