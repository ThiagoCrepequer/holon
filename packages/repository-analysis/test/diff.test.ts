import { describe, expect, it } from "vitest";

import { collectChangedLines, splitPullRequestDiff } from "../src/index.js";

describe("unified diff mapping", () => {
  it("splits the canonical GitHub three-dot diff into reviewable files", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/src/b.ts b/src/b.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/b.ts",
      "@@ -0,0 +1 @@",
      "+export const b = true;",
      "",
    ].join("\n");

    expect(splitPullRequestDiff(diff)).toEqual([
      { path: "src/a.ts", patch: expect.stringContaining("+new") },
      {
        path: "src/b.ts",
        patch: expect.stringContaining("+export const b = true;"),
      },
    ]);
  });

  it("rejects a two-tip patch without GitHub file boundaries", () => {
    expect(() => splitPullRequestDiff("@@ -1 +1 @@\n-old\n+new")).toThrow(
      "canonical GitHub pull request diff",
    );
  });

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
