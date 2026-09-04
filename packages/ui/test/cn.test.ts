import { describe, expect, it } from "vitest";

import { cn } from "../src/utils/cn.js";

describe("cn utility", () => {
  it("combines class names correctly", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });

  it("handles conditional classes", () => {
    const isFalse = false as boolean;
    const isTrue = true as boolean;
    expect(cn("px-2", isFalse && "py-1", isTrue && "bg-red-500")).toBe(
      "px-2 bg-red-500",
    );
  });

  it("merges tailwind conflicts correctly using twMerge", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("bg-red-500", "bg-blue-500")).toBe("bg-blue-500");
  });
});
