import { describe, expect, it } from "vitest";

import {
  collectChangedLines,
  isNonBinaryPullRequestPatch,
  splitPullRequestDiff,
} from "../src/index.js";

describe("unified diff mapping", () => {
  it("accepts an empty canonical diff", () => {
    expect(splitPullRequestDiff("  \n")).toEqual([]);
  });

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

  it("decodes Git-quoted UTF-8 paths without treating spaces as separators", () => {
    const diff = [
      'diff --git "a/docs/vis\\303\\243o geral.md" "b/docs/vis\\303\\243o geral.md"',
      '--- "a/docs/vis\\303\\243o geral.md"',
      '+++ "b/docs/vis\\303\\243o geral.md"',
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");

    expect(splitPullRequestDiff(diff)).toEqual([
      {
        patch: expect.stringContaining("+new"),
        path: "docs/visão geral.md",
      },
    ]);
  });

  it("rejects a two-tip patch without GitHub file boundaries", () => {
    expect(() => splitPullRequestDiff("@@ -1 +1 @@\n-old\n+new")).toThrow(
      "canonical GitHub pull request diff",
    );
  });

  it("rejects a diff section that identifies no repository path", () => {
    expect(() =>
      splitPullRequestDiff(
        [
          "diff --git /dev/null /dev/null",
          "--- /dev/null",
          "+++ /dev/null",
        ].join("\n"),
      ),
    ).toThrow("does not identify a repository path");
  });

  it("distinguishes textual and metadata patches from binary content", () => {
    const textual = [
      "diff --git a/README.md b/README.md",
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");
    const binary = [
      "diff --git a/assets/logo.png b/assets/logo.png",
      "new file mode 100644",
      "index 0000000..1234567",
      "Binary files /dev/null and b/assets/logo.png differ",
    ].join("\n");
    const modeOnly = [
      "diff --git a/script.sh b/script.sh",
      "old mode 100644",
      "new mode 100755",
    ].join("\n");

    expect(isNonBinaryPullRequestPatch(textual)).toBe(true);
    expect(isNonBinaryPullRequestPatch(binary)).toBe(false);
    expect(isNonBinaryPullRequestPatch(modeOnly)).toBe(true);
    expect(() => isNonBinaryPullRequestPatch(`${textual}\n${textual}`)).toThrow(
      "one repository path",
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
    expect(collectChangedLines("src/index.ts", patch, 1)).toEqual([
      { line: 4, path: "src/index.ts", side: "RIGHT" },
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
    expect(() => collectChangedLines("src/index.ts", "+line", 0)).toThrow(
      "maximumLines",
    );
    const onePatch = ["--- a/a.ts", "+++ b/a.ts", "@@ -0,0 +1 @@", "+a"].join(
      "\n",
    );
    expect(() =>
      collectChangedLines("src/index.ts", `${onePatch}\n${onePatch}`),
    ).toThrow("one repository path");
    expect(() =>
      collectChangedLines("src/index.ts", "@@ -0,0 +1,2 @@\n+only-one"),
    ).toThrow(/line count/iu);
  });
});
