import { describe, expect, it, vi } from "vitest";

import { consoleLogger, errorKind } from "../src/observability.js";

describe("structured observability", () => {
  it("emits machine-readable fields without adding arbitrary values", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    consoleLogger.emit("review.completed", {
      durationMs: 12,
      outcome: "completed",
    });
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
      durationMs: 12,
      event: "review.completed",
      outcome: "completed",
    });
  });

  it("reduces errors to a non-sensitive class name", () => {
    expect(errorKind(new TypeError("secret-bearing message"))).toBe(
      "TypeError",
    );
    expect(errorKind("secret-bearing message")).toBe("UnknownError");
  });
});
