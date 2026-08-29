import { describe, expect, it } from "vitest";

import { collectChangedLines } from "../src/index.js";

describe("unified diff mapping", () => {
  it("maps only added right-side lines across hunks", () => {
    const patch = [
      "@@ -3,3 +3,4 @@ function example() {",
      " context",
      "-removed",
      "+added",
      "+another",
      " context",
      "@@ -20 +21,2 @@",
      "+tail",
      " context",
      "\\ No newline at end of file",
    ].join("\n");

    expect(collectChangedLines("src/index.ts", patch)).toEqual([
      { line: 4, path: "src/index.ts", side: "RIGHT" },
      { line: 5, path: "src/index.ts", side: "RIGHT" },
      { line: 21, path: "src/index.ts", side: "RIGHT" },
    ]);
  });

  it("ignores content outside hunks and rejects malformed hunk coordinates", () => {
    expect(
      collectChangedLines(
        "src/index.ts",
        "diff --git a/file b/file\n+metadata",
      ),
    ).toEqual([]);
    expect(() =>
      collectChangedLines("src/index.ts", "@@ malformed @@\n+line"),
    ).toThrow("Malformed unified diff");
  });
});
