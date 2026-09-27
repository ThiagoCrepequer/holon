import { describe, expect, it } from "vitest";

import { canStartAttempt } from "../src/smoke/retry-budget.js";

describe("review smoke: retry budget", () => {
  it("allows attempts while the budget is available", () => {
    expect(canStartAttempt(0, 3)).toBe(true);
    expect(canStartAttempt(1, 3)).toBe(true);
    expect(canStartAttempt(2, 3)).toBe(true);
  });

  it("stops when the last permitted attempt has completed", () => {
    expect(canStartAttempt(3, 3)).toBe(false);
  });

  it("rejects attempts beyond the budget", () => {
    expect(canStartAttempt(4, 3)).toBe(false);
  });

  it("does not start a job with a zero attempt budget", () => {
    expect(canStartAttempt(0, 0)).toBe(false);
  });
});
