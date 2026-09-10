import type { ExecutorRequest } from "@holon/contracts";
import { describe, expect, it } from "vitest";

import { buildReviewArtifacts } from "../src/review-context.js";

function patch(path: string) {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1 @@\n+${"x".repeat(50_000)}\n`;
}
function artifacts(paths: string[]) {
  const request: ExecutorRequest = {
    baseSha: "b".repeat(40),
    headSha: "a".repeat(40),
    cloneUrl: "https://github.com/acme/api.git",
    runId: `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}`,
    pullRequestNumber: 7,
    repositoryId: 42,
    installationId: 99,
    repositoryName: "api",
    repositoryOwner: "acme",
    canonicalDiff: paths.map(patch).join(""),
    effectivePolicy: {
      baseSha: "b".repeat(40),
      additionalExcludes: [],
      effectivePolicyDigest: "c".repeat(64),
      source: "default",
      sourceDigest: null,
      verdictStrictness: "default",
    },
  };
  return buildReviewArtifacts(request, []);
}
describe("plan before context selection", () => {
  it("retains whole patches beyond 120 kB when the bounded shard plan fits", () => {
    const paths = [
      "apps/core.ts",
      "packages/domain/lifecycle.ts",
      "packages/model/reviewer.ts",
    ];
    const result = artifacts(paths);
    expect(result.context.files.map((f) => f.path)).toEqual(paths);
    expect(result.context.files.map((f) => f.patch)).toEqual(paths.map(patch));
    expect(result.context.truncated).toBe(false);
    expect(result.plan.shards).toHaveLength(3);
    expect(result.contextBytes).toBeLessThanOrEqual(500_000);
    expect(result.context.changedLines).toEqual(
      paths.map((path) => ({ path, line: 1, side: "RIGHT" })),
    );
  });
  it("retains exactly the bounded plan and reports an omitted sixth shard", () => {
    const result = artifacts(
      Array.from({ length: 6 }, (_, i) => `src/module${i}.ts`),
    );
    expect(result.plan.shards).toHaveLength(5);
    expect(result.context.files).toHaveLength(5);
    expect(result.context.files).toEqual(
      result.plan.shards.flatMap((s) => s.files),
    );
    expect(result.context.truncated).toBe(true);
    expect(result.plan.scopeStatus).toBe("partial_by_policy");
    expect(result.contextBytes).toBeLessThanOrEqual(500_000);
  });
});
