import { reviewExecutionLimits } from "@holon/contracts";
import { describe, expect, it } from "vitest";

import { splitPullRequestDiff } from "../src/diff.js";
import { buildReviewPlan } from "../src/plan.js";

it("packs related source and tests together without fragmenting a moderate PR", () => {
  const paths = Array.from({ length: 16 }, (_, index) => [
    `packages/core/src/unit${index}.ts`,
    `packages/core/test/unit${index}.test.ts`,
  ]).flat();
  const files = splitPullRequestDiff(
    paths
      .map(
        (path) =>
          `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1,40 @@\n${Array.from({ length: 40 }, (_, i) => `+export const value${i} = ${i};`).join("\n")}\n`,
      )
      .join(""),
  );
  const plan = buildReviewPlan(files);
  expect(plan.scopeStatus).toBe("complete");
  expect(plan.totalEligibleLines).toBe(1280);
  expect(plan.shards.length).toBeLessThanOrEqual(6);
  expect(plan.shards.flatMap((shard) => shard.changedLines)).toHaveLength(1280);
  for (let index = 0; index < 16; index++) {
    const shard = plan.shards.find((part) =>
      part.files.some(
        (file) => file.path === `packages/core/src/unit${index}.ts`,
      ),
    );
    expect(shard?.files.map((file) => file.path)).toContain(
      `packages/core/test/unit${index}.test.ts`,
    );
  }
  expect(buildReviewPlan(files.toReversed())).toEqual(plan);
});

it("splits oversized related groups and never joins matching names from different projects", () => {
  const paths = [
    "apps/a/src/auth.ts",
    "apps/a/test/auth.test.ts",
    "apps/b/src/auth.ts",
    "apps/b/test/auth.spec.ts",
  ];
  const files = splitPullRequestDiff(
    paths.map((path) => patchFor(path)).join(""),
  );
  const pairs = buildReviewPlan(files, { maxShardFiles: 2 });
  expect(
    pairs.shards.map((shard) => shard.files.map((file) => file.path)),
  ).toEqual([paths.slice(0, 2), paths.slice(2)]);
  const singles = buildReviewPlan(files, { maxShardFiles: 1 });
  expect(singles.shards).toHaveLength(4);
  expect(singles.scopeStatus).toBe("complete");
});

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
    splitPullRequestDiff(patchFor("src/a.ts", 120_001) + patchFor("src/b.ts")),
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

it("retains 51 eligible files instead of applying the obsolete global file cap", () => {
  const plan = buildReviewPlan(
    splitPullRequestDiff(
      Array.from({ length: 51 }, (_, i) =>
        patchFor(`src/file${String(i).padStart(2, "0")}.ts`),
      ).join(""),
    ),
  );
  expect(plan.totalEligibleFiles).toBe(51);
  expect(plan.shards.flatMap((s) => s.files)).toHaveLength(51);
  expect(plan.scopeStatus).toBe("complete");
  expect(plan.omissionReasons).toEqual([]);
});

it("covers more than fifty files with fewer shards under the tolerant work budget", () => {
  const plan = buildReviewPlan(
    splitPullRequestDiff(
      Array.from({ length: 61 }, (_, i) => patchFor(`src/f${i}.ts`)).join(""),
    ),
  );
  expect(plan.scopeStatus).toBe("complete");
  expect(plan.shards.length).toBeLessThanOrEqual(4);
  expect(
    new Set(plan.shards.flatMap((s) => s.files.map((f) => f.path))).size,
  ).toBe(61);
});
it("partitions a large single hunk without losing canonical added coordinates or bytes", () => {
  const body = Array.from(
    { length: 800 },
    (_, i) => `+const item${i} = "${"é".repeat(60)}";`,
  ).join("\n");
  const patch = `diff --git a/src/large.ts b/src/large.ts\n--- a/src/large.ts\n+++ b/src/large.ts\n@@ -0,0 +1,800 @@\n${body}\n`;
  const plan = buildReviewPlan(splitPullRequestDiff(patch));
  expect(plan.scopeStatus).toBe("complete");
  expect(plan.shards.length).toBeGreaterThan(1);
  expect(plan.shards.flatMap((s) => s.changedLines.map((l) => l.line))).toEqual(
    Array.from({ length: 800 }, (_, i) => i + 1),
  );
  const retained = plan.shards.flatMap((s) =>
    s.files.flatMap((f) =>
      f.patch
        .split("\n")
        .filter((l) => l.startsWith("+") && !l.startsWith("+++")),
    ),
  );
  expect(retained.join("\n")).toBe(body);
  for (const shard of plan.shards)
    expect(shard.byteLength).toBeLessThanOrEqual(
      reviewExecutionLimits.shardPatchBytes,
    );
});

it("packs small hunks of the same file without spending one shard per hunk", () => {
  const patch = `diff --git a/src/hunks.ts b/src/hunks.ts\n--- a/src/hunks.ts\n+++ b/src/hunks.ts\n${Array.from({ length: 200 }, (_, i) => `@@ -${i * 10 + 1},1 +${i * 10 + 1},1 @@\n-old\n+new  \n`).join("")}`;
  const plan = buildReviewPlan(splitPullRequestDiff(patch));
  expect(plan.scopeStatus).toBe("complete");
  expect(plan.shards.length).toBeLessThan(12);
  expect(plan.shards.flatMap((s) => s.changedLines).map((l) => l.line)).toEqual(
    Array.from({ length: 200 }, (_, i) => i * 10 + 1),
  );
  expect(plan.shards.every((s) => s.files.length === 1)).toBe(true);
  expect(
    plan.shards.flatMap((s) =>
      s.files.flatMap((f) =>
        f.patch.split("\n").filter((line) => line.startsWith("+new")),
      ),
    ),
  ).toEqual(Array(200).fill("+new  "));
});

it("groups observed producer/consumer edges and retains hard shard limits", () => {
  const paths = ["a/consumer.ts", "b/unrelated.ts", "c/producer.ts"];
  const files = splitPullRequestDiff(
    paths.map((path) => patchFor(path)).join(""),
  );
  const relationships = [{ callerPath: paths[0]!, targetPath: paths[2]! }];
  const related = buildReviewPlan(files, { maxShardFiles: 2, relationships });
  expect(
    related.shards.some((shard) =>
      paths
        .filter((path) => path !== paths[1])
        .every((path) => shard.files.some((file) => file.path === path)),
    ),
  ).toBe(true);
  expect(
    buildReviewPlan(files.toReversed(), {
      maxShardFiles: 2,
      relationships: relationships.toReversed(),
    }),
  ).toEqual(related);
  const constrained = buildReviewPlan(files, {
    maxShardFiles: 1,
    relationships,
  });
  expect(constrained.shards).toHaveLength(3);
  expect(constrained.shards.every((shard) => shard.files.length <= 1)).toBe(
    true,
  );
});
