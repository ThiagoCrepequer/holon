import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "vitest";
expect.extend(matchers);
afterEach(cleanup);
// jsdom has no native top layer; keyboard/focus behavior is proved in Playwright.
HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
HTMLDialogElement.prototype.close = function () {
  this.open = false;
};
