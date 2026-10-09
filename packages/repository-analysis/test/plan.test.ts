import {
  reviewExecutionLimits,
  type StructuralImpactReport,
} from "@holon/contracts";
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

function connectedImpact(): StructuralImpactReport {
  return {
    changedSymbols: [
      {
        path: "packages/core/src/api.ts",
        name: "send",
        line: 1,
        kind: "function",
        change: "modified",
        isExported: true,
      },
    ],
    contractBreaks: [],
    securitySurfaces: [],
    downstreamReferences: [
      {
        targetPath: "packages/core/src/api.ts",
        callerPath: "apps/web/src/client.ts",
        callerLine: 1,
        symbolName: "send",
        excerpt: "send()",
      },
    ],
  };
}
it.each([false, true])(
  "keeps global structural inventory gaps partial without degrading every shard (scan=%s)",
  (scan) => {
    const impact = {
      ...connectedImpact(),
      repositoryScanTruncated: scan,
      omittedSignals: {
        changedSymbols: scan ? 0 : 351,
        contractBreaks: 0,
        downstreamReferences: 0,
        securitySurfaces: 0,
      },
    };
    const plan = buildReviewPlan(
      splitPullRequestDiff(patchFor("src/alone.ts")),
      { structuralImpact: impact },
    );
    expect(plan.scopeStatus).toBe("partial_by_policy");
    expect(plan.omissionReasons).toContainEqual({
      code: "structural_inventory",
      count: scan ? 0 : 351,
      repositoryScanTruncated: scan,
    });
  },
);
it("co-locates contracts and consumers with different names using verified structural relationships", () => {
  const files = splitPullRequestDiff(
    ["aaa.ts", "apps/web/src/client.ts", "packages/core/src/api.ts"]
      .map((path) => patchFor(path))
      .join(""),
  );
  const plan = buildReviewPlan(files, {
    maxShardFiles: 2,
    structuralImpact: connectedImpact(),
  });
  expect(
    plan.shards
      .find((shard) =>
        shard.files.some((file) => file.path === "packages/core/src/api.ts"),
      )
      ?.files.map((file) => file.path),
  ).toEqual(
    expect.arrayContaining([
      "apps/web/src/client.ts",
      "packages/core/src/api.ts",
    ]),
  );
  expect(
    buildReviewPlan(files.toReversed(), {
      maxShardFiles: 2,
      structuralImpact: connectedImpact(),
    }),
  ).toEqual(plan);
});
it("does not schedule redundant contract checks when complete patches share a shard and declarations are outside the diff", () => {
  const files = splitPullRequestDiff(
    ["apps/web/src/client.ts", "packages/core/src/api.ts"]
      .map(
        (path) =>
          `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -40 +40 @@\n-return 1;\n+return 2;\n`,
      )
      .join(""),
  );
  const plan = buildReviewPlan(files, { structuralImpact: connectedImpact() });
  expect(plan.scopeStatus).toBe("complete");
  expect(plan.omissionReasons).toEqual([]);
  expect(plan.shards).toHaveLength(1);
  expect(plan.shards[0]!.files.map((file) => file.patch)).toEqual(
    expect.arrayContaining(files.map((file) => file.patch)),
  );
});
it("adds bounded canonical contract windows when a relationship crosses partitions", () => {
  const files = splitPullRequestDiff(
    ["apps/web/src/client.ts", "packages/core/src/api.ts"]
      .map(
        (path) =>
          `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1,600 @@\n${"+export const value = 1;\n".repeat(600)}`,
      )
      .join(""),
  );
  const plan = buildReviewPlan(files, { structuralImpact: connectedImpact() });
  expect(plan.shards).toHaveLength(3);
  const check = plan.shards[2]!;
  expect(check.id).toBe("contract-check-0");
  expect(check.changedLines).toHaveLength(160);
  expect(
    check.changedLines.every((line) => line.line >= 1 && line.line <= 80),
  ).toBe(true);
  expect(
    check.files.every((file) =>
      file.patch.includes("+export const value = 1;"),
    ),
  ).toBe(true);
  expect(plan.shards.every((shard) => shard.totalShards === 3)).toBe(true);
  expect(plan.totalEligibleLines).toBe(1200);
  expect(plan.scopeStatus).toBe("complete");
});
it("pairs the verified body edit with a canonical caller instead of omitting its unchanged import", () => {
  const files = splitPullRequestDiff(
    ["apps/web/src/client.ts", "packages/core/src/api.ts"]
      .map(
        (path) =>
          `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -500,100 +500,100 @@\n${"-old\n+new\n".repeat(100)}`,
      )
      .join(""),
  );
  const impact = connectedImpact();
  impact.changedSymbols[0]!.patchLine = 540;
  impact.downstreamReferences.push({
    ...impact.downstreamReferences[0]!,
    callerLine: 540,
  });
  const plan = buildReviewPlan(files, {
    structuralImpact: impact,
    maxShardLines: 150,
  });
  expect(plan.scopeStatus).toBe("complete");
  expect(plan.omissionReasons).toEqual([]);
  const checks = plan.shards.filter((shard) =>
    shard.id.startsWith("contract-check-"),
  );
  expect(checks).toHaveLength(1);
  expect(checks[0]!.changedLines).toContainEqual({
    path: "packages/core/src/api.ts",
    line: 540,
    side: "RIGHT",
  });
  expect(checks[0]!.changedLines).toContainEqual({
    path: "apps/web/src/client.ts",
    line: 540,
    side: "RIGHT",
  });
});
it("uses a whole bounded caller patch when its discovery reference is unchanged and outside the diff", () => {
  const files = splitPullRequestDiff(
    `diff --git a/packages/core/src/api.ts b/packages/core/src/api.ts\n--- a/packages/core/src/api.ts\n+++ b/packages/core/src/api.ts\n@@ -500,100 +500,100 @@\n${"-old\n+new\n".repeat(100)}` +
      "diff --git a/apps/web/src/client.ts b/apps/web/src/client.ts\n--- a/apps/web/src/client.ts\n+++ b/apps/web/src/client.ts\n@@ -900 +900 @@\n-old\n+new\n",
  );
  const impact = connectedImpact();
  impact.changedSymbols[0]!.patchLine = 540;
  const plan = buildReviewPlan(files, {
    structuralImpact: impact,
    maxShardLines: 100,
  });
  expect(plan.scopeStatus).toBe("complete");
  const check = plan.shards.find((shard) =>
    shard.id.startsWith("contract-check-"),
  );
  expect(
    check?.files.find((file) => file.path === "apps/web/src/client.ts")?.patch,
  ).toBe(files[1]!.patch);
  expect(check?.changedLines).toContainEqual({
    path: "apps/web/src/client.ts",
    line: 900,
    side: "RIGHT",
  });
  expect(check?.changedLines).not.toContainEqual({
    path: "apps/web/src/client.ts",
    line: 1,
    side: "RIGHT",
  });
});
it("shares the same canonical producer window across nine consumers without spending nine contract parts", () => {
  const target = "packages/core/src/api.ts";
  const callers = Array.from(
    { length: 9 },
    (_, index) => `apps/web/src/client-${index}.ts`,
  );
  const files = splitPullRequestDiff(
    callers.map((path) => patchFor(path)).join("") +
      `diff --git a/${target} b/${target}\n--- a/${target}\n+++ b/${target}\n@@ -0,0 +1,1200 @@\n${"+export const value = 1;\n".repeat(1200)}`,
  );
  const impact = connectedImpact();
  impact.changedSymbols[0]!.patchLine = 1000;
  impact.downstreamReferences = callers.map((path) => ({
    ...impact.downstreamReferences[0]!,
    callerPath: path,
  }));
  const plan = buildReviewPlan(files, {
    structuralImpact: impact,
    maxShardLines: 200,
  });
  expect(plan.scopeStatus).toBe("complete");
  expect(plan.omissionReasons).toEqual([]);
  const checks = plan.shards.filter((shard) =>
    shard.id.startsWith("contract-check-"),
  );
  expect(checks).toHaveLength(1);
  expect(checks[0]!.files.map((file) => file.path)).toEqual(
    expect.arrayContaining([target, ...callers]),
  );
  expect(checks[0]!.changedLines).toContainEqual({
    path: target,
    line: 1000,
    side: "RIGHT",
  });
  expect(checks[0]!.changedLines).toHaveLength(89);
});
it("reports contract relationships left unchecked by part or canonical-window limits", () => {
  const files = splitPullRequestDiff(
    ["apps/web/src/client.ts", "packages/core/src/api.ts"]
      .map((path) => patchFor(path))
      .join(""),
  );
  const impact = connectedImpact();
  const plan = buildReviewPlan(files, {
    structuralImpact: impact,
    maxShardFiles: 1,
  });
  expect(plan.scopeStatus).toBe("partial_by_policy");
  expect(plan.omissionReasons).toContainEqual({
    code: "contract_checks",
    count: 1,
    reasons: { capacity: 1, missingWindow: 0, evidenceWindows: 0 },
  });
  expect(plan.shards).toHaveLength(2);
  const outside = {
    ...impact,
    changedSymbols: impact.changedSymbols.map((item) => ({
      ...item,
      line: 1000,
    })),
  };
  expect(
    buildReviewPlan(files, {
      structuralImpact: outside,
      maxShardLines: 1,
      maxShards: 2,
    }).omissionReasons,
  ).toContainEqual({
    code: "contract_checks",
    count: 1,
    reasons: { capacity: 1, missingWindow: 0, evidenceWindows: 0 },
  });
});

it("keeps an unavailable caller window partial and reports its precise reason", () => {
  const files = splitPullRequestDiff(
    ["apps/web/src/client.ts", "packages/core/src/api.ts"]
      .map(
        (path) =>
          `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -500,100 +500,100 @@\n${"-old\n+new\n".repeat(100)}`,
      )
      .join(""),
  );
  const impact = connectedImpact();
  impact.changedSymbols[0]!.patchLine = 540;
  const plan = buildReviewPlan(files, {
    structuralImpact: impact,
    maxShardLines: 150,
  });
  expect(plan.scopeStatus).toBe("partial_by_policy");
  expect(plan.omissionReasons).toContainEqual({
    code: "contract_checks",
    count: 1,
    reasons: { capacity: 0, missingWindow: 1, evidenceWindows: 0 },
  });
});

it.each([19, 24, 50, 64])(
  "retains every eligible part of a %s-part canonical plan",
  (count) => {
    const files = splitPullRequestDiff(
      Array.from({ length: count }, (_, index) => {
        const path = `src/file-${index}.ts`;
        return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1,600 @@\n${"+export const value = 1;\n".repeat(600)}`;
      }).join(""),
    );
    const plan = buildReviewPlan(files);
    expect(plan.shards).toHaveLength(count);
    expect(plan.totalEligibleLines).toBe(count * 600);
    expect(plan.scopeStatus).toBe("complete");
    expect(plan.omissionReasons).toEqual([]);
  },
);

it("limits complete canonical contract windows including unchanged context", () => {
  const paths = ["apps/web/src/client.ts", "packages/core/src/api.ts"];
  const files = splitPullRequestDiff(
    paths
      .map(
        (path) =>
          `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,100 +1,1000 @@\n${" existing\n".repeat(100)}${"+changed\n".repeat(900)}`,
      )
      .join(""),
  );
  const impact = connectedImpact();
  // Different base parts are required here; their canonical content is sufficient
  // for the cross-check despite a strict global part count.
  const plan = buildReviewPlan(files, {
    structuralImpact: impact,
    maxShardDiffBytes: 96_000,
  });
  const check = plan.shards.find((shard) =>
    shard.id.startsWith("contract-check-"),
  );
  expect(check).toBeDefined();
  for (const file of check!.files) {
    const body = file.patch
      .split("\n")
      .filter(
        (line) =>
          /^[ +-]/u.test(line) &&
          !line.startsWith("---") &&
          !line.startsWith("+++"),
      );
    expect(body.length).toBeLessThanOrEqual(80);
  }
});
it("uses original coordinates for a deleted symbol displaced by preceding removals", () => {
  const source = "packages/core/src/api.ts";
  const caller = "apps/web/src/client.ts";
  const diff = `diff --git a/${source} b/${source}\n--- a/${source}\n+++ b/${source}\n@@ -1,200 +0,0 @@\n${"-old context\n".repeat(200)}@@ -500,1 +299,0 @@\n-export const gone = 1;\n@@ -701,1 +500,1 @@\n-marker old\n+marker new\ndiff --git a/${caller} b/${caller}\n--- a/${caller}\n+++ b/${caller}\n@@ -0,0 +1,600 @@\n${"+gone();\n".repeat(600)}`;
  const impact = connectedImpact();
  impact.changedSymbols[0] = {
    ...impact.changedSymbols[0]!,
    name: "gone",
    line: 500,
    change: "deleted",
  };
  impact.downstreamReferences[0] = {
    ...impact.downstreamReferences[0]!,
    symbolName: "gone",
  };
  const plan = buildReviewPlan(splitPullRequestDiff(diff), {
    structuralImpact: impact,
    maxShardLines: 400,
  });
  const check = plan.shards.find((shard) =>
    shard.id.startsWith("contract-check-"),
  );
  expect(check).toBeDefined();
  const patch = check!.files.find((file) => file.path === source)!.patch;
  expect(patch).toContain("-export const gone = 1;");
  expect(patch).not.toContain("marker new");
});
