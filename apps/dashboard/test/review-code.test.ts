// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { ReviewCode } from "../app/features/reviews/review-code.js";

it("code scroll keys stay bounded and leave page shortcuts and modifiers alone", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.querySelector("body")!.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(ReviewCode, null, "original code"));
    });
    const code = container.querySelector("pre")!;
    Object.defineProperties(code, {
      scrollWidth: { value: 200, configurable: true },
      clientWidth: { value: 50, configurable: true },
    });
    const key = (value: string, shiftKey = false) => {
      const event = new KeyboardEvent("keydown", {
        key: value,
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      code.dispatchEvent(event);
      return event;
    };
    expect(key("ArrowRight").defaultPrevented).toBe(true);
    expect(code.scrollLeft).toBe(40);
    key("End");
    expect(code.scrollLeft).toBe(150);
    key("ArrowRight");
    expect(code.scrollLeft).toBe(150);
    key("ArrowLeft");
    expect(code.scrollLeft).toBe(110);
    key("Home");
    expect(code.scrollLeft).toBe(0);
    expect(key("Escape").defaultPrevented).toBe(false);
    expect(key("ArrowRight", true).defaultPrevented).toBe(false);
    Object.defineProperty(code, "clientWidth", { value: 200 });
    expect(key("ArrowRight").defaultPrevented).toBe(false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
