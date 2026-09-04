import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Drawer,
  DrawerBackdrop,
  DrawerBody,
  DrawerClose,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerPopup,
  DrawerTitle,
  DrawerTrigger,
} from "../src/components/drawer/drawer.js";

describe("Drawer component", () => {
  it("renders trigger element", () => {
    const html = renderToStaticMarkup(
      <Drawer>
        <DrawerTrigger>Open Drawer</DrawerTrigger>
      </Drawer>,
    );
    expect(html).toContain("Open Drawer");
  });

  it("renders drawer header, title, description, body, footer, and close within Drawer root", () => {
    const html = renderToStaticMarkup(
      <Drawer>
        <DrawerHeader className="custom-drawer-header">
          <DrawerTitle className="custom-drawer-title">Run Detail</DrawerTitle>
          <DrawerDescription className="custom-drawer-desc">
            Detailed run inspection
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="custom-drawer-body">
          <div>Drawer inspection body</div>
        </DrawerBody>
        <DrawerFooter className="custom-drawer-footer">
          <DrawerClose>Close</DrawerClose>
        </DrawerFooter>
      </Drawer>,
    );

    expect(html).toContain("custom-drawer-header");
    expect(html).toContain("custom-drawer-title");
    expect(html).toContain("Run Detail");
    expect(html).toContain("custom-drawer-desc");
    expect(html).toContain("Detailed run inspection");
    expect(html).toContain("custom-drawer-body");
    expect(html).toContain("Drawer inspection body");
    expect(html).toContain("custom-drawer-footer");
    expect(html).toContain("Close");
  });

  it("executes render on DrawerBackdrop and DrawerPopup", () => {
    const backdropEl = (
      DrawerBackdrop as unknown as { render: Function }
    ).render({ className: "test-backdrop" }, null);
    expect(backdropEl.props.className).toContain("test-backdrop");
    expect(backdropEl.props.className).toContain("fixed inset-0");

    const popupEl = (DrawerPopup as unknown as { render: Function }).render(
      { className: "test-popup", children: "Drawer Body" },
      null,
    );
    expect(popupEl).toBeDefined();
  });
});
