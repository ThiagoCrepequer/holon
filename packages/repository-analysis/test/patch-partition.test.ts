import { expect, it } from "vitest";

import { collectChangedLines } from "../src/diff.js";
import { evidenceWindowCount, partitionPatch } from "../src/patch-partition.js";

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

it("bounds evidence windows and bytes while preserving sparse additions and plus-prefixed code", () => {
  const patch = `@@ -1,100 +1,200 @@\n${Array.from({ length: 100 }, (_, i) => ` context${i}\n+++value${i};`).join("\n")}\n`;
  const result = partitionPatch(patch, 5000, 50);
  expect(result.omittedLines).toBe(0);
  expect(result.patches.length).toBeGreaterThan(1);
  expect(result.patches.flatMap((p) => collectChangedLines("a.ts", p))).toEqual(
    collectChangedLines("a.ts", patch),
  );
  for (const part of result.patches) {
    expect(evidenceWindowCount(part)).toBeLessThanOrEqual(50);
    expect(collectChangedLines("a.ts", part).length).toBeLessThanOrEqual(50);
    expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(5000);
  }
});

it("counts large UTF-8 windows without rescanning previously accumulated source", () => {
  const patch = `@@ -0,0 +1,1000 @@\n${Array.from({ length: 1000 }, (_, i) => `+${i % 3 ? "é".repeat(350) : ""}`).join("\n")}\n`;
  const result = partitionPatch(patch, 48_000, 384);
  expect(result.omittedLines).toBe(0);
  expect(
    result.patches.flatMap((p) => collectChangedLines("a.ts", p)),
  ).toHaveLength(1000);
  expect(
    result.patches.every(
      (p) =>
        evidenceWindowCount(p) <= 48 &&
        new TextEncoder().encode(p).length <= 48_000,
    ),
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
  expect(result.patches).toHaveLength(1);
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

it("keeps no-newline markers attached inside a bounded canonical content window", () => {
  const patch =
    "@@ -1,1 +1,2 @@\n-old\n\\ No newline at end of file\n+new\n+following\n";
  const split = partitionPatch(patch, 1000, 80, 3);
  expect(split.omittedLines).toBe(0);
  expect(split.patches).toHaveLength(2);
  expect(split.patches[0]).toContain(
    "-old\n\\ No newline at end of file\n+new\n",
  );
  expect(split.patches[1]).toContain("+following\n");
  expect(split.patches[1]).not.toContain("No newline");
});
