import { describe, expect, it } from "vitest";

import { splitPullRequestDiff } from "../src/diff.js";
import { buildReviewPlan } from "../src/plan.js";

describe("buildReviewPlan", () => {
  it("returns unsupported plan when diff only contains binary or ignored files", () => {
    const diff =
      "diff --git a/package-lock.json b/package-lock.json\n--- a/package-lock.json\n+++ b/package-lock.json\n@@ -1 +1 @@\n-old\n+new\n";
    const diffFiles = splitPullRequestDiff(diff);
    const plan = buildReviewPlan(diffFiles);

    expect(plan.scopeStatus).toBe("unsupported");
    expect(plan.shards).toHaveLength(0);
    expect(plan.unsupportedFilesCount).toBe(1);
    expect(plan.totalEligibleFiles).toBe(0);
  });

  it("builds a single complete shard for small diffs", () => {
    const diff =
      "diff --git a/src/utils.ts b/src/utils.ts\n--- a/src/utils.ts\n+++ b/src/utils.ts\n@@ -1 +1 @@\n-old\n+new\n" +
      "diff --git a/docs/README.md b/docs/README.md\n--- a/docs/README.md\n+++ b/docs/README.md\n@@ -1 +1 @@\n-old\n+new\n";
    const diffFiles = splitPullRequestDiff(diff);
    const plan = buildReviewPlan(diffFiles);

    expect(plan.scopeStatus).toBe("complete");
    expect(plan.shards).toHaveLength(1);
    expect(plan.totalEligibleFiles).toBe(2);
    expect(plan.totalEligibleLines).toBe(2);
    expect(plan.shards[0]!.files).toHaveLength(2);
    expect(plan.shards[0]!.files[0]!.path).toBe("src/utils.ts");
    expect(plan.shards[0]!.files[0]!.mode).toBe("structural");
    expect(plan.shards[0]!.files[1]!.path).toBe("docs/README.md");
    expect(plan.shards[0]!.files[1]!.mode).toBe("textual");
  });

  it("partitions into multiple shards when exceeding file or byte limits", () => {
    const diff =
      "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n" +
      "diff --git a/src/b.ts b/src/b.ts\n--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1 +1 @@\n-old\n+new\n" +
      "diff --git a/src/c.ts b/src/c.ts\n--- a/src/c.ts\n+++ b/src/c.ts\n@@ -1 +1 @@\n-old\n+new\n";
    const diffFiles = splitPullRequestDiff(diff);

    const plan = buildReviewPlan(diffFiles, {
      maxShardFiles: 1,
      maxShards: 5,
    });

    expect(plan.scopeStatus).toBe("complete");
    expect(plan.shards).toHaveLength(3);
    expect(plan.shards[0]!.files[0]!.path).toBe("src/a.ts");
    expect(plan.shards[1]!.files[0]!.path).toBe("src/b.ts");
    expect(plan.shards[2]!.files[0]!.path).toBe("src/c.ts");
  });

  it("marks partial_by_policy when number of shards exceeds maxShards limit", () => {
    const diff =
      "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n" +
      "diff --git a/src/b.ts b/src/b.ts\n--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1 +1 @@\n-old\n+new\n" +
      "diff --git a/src/c.ts b/src/c.ts\n--- a/src/c.ts\n+++ b/src/c.ts\n@@ -1 +1 @@\n-old\n+new\n";
    const diffFiles = splitPullRequestDiff(diff);

    const plan = buildReviewPlan(diffFiles, {
      maxShardFiles: 1,
      maxShards: 2,
    });

    expect(plan.scopeStatus).toBe("partial_by_policy");
    expect(plan.shards).toHaveLength(2);
    expect(plan.omissionReasons).toHaveLength(1);
    expect(plan.omissionReasons).toEqual([
      { code: "shard_limit", maximum: 2, planned: 3 },
    ]);
  });
});

function patchFor(path: string, bytes = 100): string {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1 @@\n+${"x".repeat(bytes)}\n`;
}

it("omits an oversized file completely without starving later eligible patches", () => {
  const plan = buildReviewPlan(
    splitPullRequestDiff(patchFor("src/a.ts", 60_001) + patchFor("src/b.ts")),
  );
  expect(plan.scopeStatus).toBe("partial_by_policy");
  expect(plan.totalEligibleFiles).toBe(2);
  expect(plan.shards.flatMap((s) => s.files.map((f) => f.path))).toEqual([
    "src/b.ts",
  ]);
  expect(plan.omissionReasons).toContainEqual(
    expect.objectContaining({ code: "oversized_patches", count: 1 }),
  );
});

it("bounds selected files across all shards and records omitted eligible files", () => {
  const plan = buildReviewPlan(
    splitPullRequestDiff(
      Array.from({ length: 51 }, (_, i) =>
        patchFor(`src/file${String(i).padStart(2, "0")}.ts`),
      ).join(""),
    ),
  );
  expect(plan.totalEligibleFiles).toBe(51);
  expect(plan.shards.flatMap((s) => s.files)).toHaveLength(50);
  expect(plan.scopeStatus).toBe("partial_by_policy");
  expect(plan.omissionReasons).toContainEqual(
    expect.objectContaining({ code: "file_limit" }),
  );
});
