import { describe, expect, it } from "vitest";

import { mapReviewSurface } from "../src/index.js";

describe("deterministic review surface mapping", () => {
  it("classifies changed contracts, persistence and security lines with side coordinates", () => {
    const patch = [
      "@@ -8,2 +8,3 @@",
      "-export function loadUser(id: string) {",
      "+export function loadUser(id: string, token: string) {",
      "+  authorize(token);",
      "   return database.query(id);",
    ].join("\n");

    expect(mapReviewSurface([{ patch, path: "src/users.ts" }])).toEqual([
      {
        change: "removed",
        excerpt: "export function loadUser(id: string) {",
        kind: "contract",
        line: 8,
        path: "src/users.ts",
      },
      {
        change: "added",
        excerpt: "export function loadUser(id: string, token: string) {",
        kind: "security",
        line: 8,
        path: "src/users.ts",
      },
      {
        change: "added",
        excerpt: "authorize(token);",
        kind: "security",
        line: 9,
        path: "src/users.ts",
      },
    ]);
  });

  it("bounds output and rejects an invalid limit", () => {
    const patch = "@@ -1,0 +1,2 @@\n+if (ready) return value;\n+throw error;";
    expect(mapReviewSurface([{ patch, path: "src/a.ts" }], 1)).toHaveLength(1);
    expect(() => mapReviewSurface([], 0)).toThrow("positive safe integer");
  });
});
