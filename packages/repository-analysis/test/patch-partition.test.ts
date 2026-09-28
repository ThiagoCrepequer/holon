import { expect, it } from "vitest";

import { collectChangedLines } from "../src/diff.js";
import { partitionPatch } from "../src/patch-partition.js";

it("keeps old and new coordinates across mixed hunks, deletions and no-newline markers", () => {
  const patch =
    "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -10,4 +10,4 @@\n before\n-old\n+new\n after\n+added\n-deleted\n\\ No newline at end of file\n@@ -30,0 +30,2 @@\n+one\n+two\n";
  const result = partitionPatch(patch, 200, 3);
  expect(result.omittedLines).toBe(0);
  expect(result.patches.flatMap((p) => collectChangedLines("a.ts", p))).toEqual(
    collectChangedLines("a.ts", patch),
  );
  expect(result.patches.filter((p) => p.includes("No newline"))).toHaveLength(
    1,
  );
  expect(
    result.patches.some((p) => p.includes("-deleted\n\\ No newline")),
  ).toBe(true);
});
it("omits only an indivisible oversized line and preserves following source coordinates", () => {
  const patch = `@@ -0,0 +1,3 @@\n+first\n+${"é".repeat(500)}\n+third\n`;
  const result = partitionPatch(patch, 100, 10);
  expect(result.omittedLines).toBe(1);
  expect(
    result.patches
      .flatMap((p) => collectChangedLines("a.ts", p))
      .map((l) => l.line),
  ).toEqual([1, 3]);
  expect(
    result.patches.every((p) => new TextEncoder().encode(p).length <= 100),
  ).toBe(true);
});
it("does not discard deletion-only and metadata-only patches", () => {
  const deletion = "@@ -5,3 +5,0 @@\n-a\n-b\n-c\n";
  const result = partitionPatch(deletion, 100, 1);
  expect(result.patches).toHaveLength(3);
  expect(result.patches.flatMap((p) => collectChangedLines("a.ts", p))).toEqual(
    [],
  );
  expect(
    partitionPatch(
      "diff --git a/a.ts b/a.ts\nold mode 100644\nnew mode 100755\n",
      200,
      10,
    ).patches,
  ).toHaveLength(1);
  expect(partitionPatch("metadata".repeat(50), 10, 10).omittedLines).toBe(1);
});
