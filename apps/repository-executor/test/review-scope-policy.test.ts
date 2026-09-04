import { splitPullRequestDiff } from "@holon/repository-analysis";
import { describe, expect, it } from "vitest";

import {
  assertReviewScopePathAllowed,
  createReviewScopePolicy,
  parseReviewScopePolicy,
  serializeReviewScopePolicy,
  withReviewScopeSearchExclusions,
} from "../src/review-scope-policy.js";

describe("run-scoped repository review policy", () => {
  const renamedSecret = [
    "diff --git a/.env.production b/config.txt",
    "similarity index 50%",
    "rename from .env.production",
    "rename to config.txt",
    "--- a/.env.production",
    "+++ b/config.txt",
    "@@ -1 +1 @@",
    "-DATABASE_PASSWORD=super-secret",
    "+DATABASE_PASSWORD=rotated-secret",
  ].join("\n");

  it("persists only the otherwise-reviewable destination of a sensitive rename", () => {
    const policy = createReviewScopePolicy(splitPullRequestDiff(renamedSecret));
    expect(policy).toEqual({
      additionalExcludes: [],
      deniedPaths: ["config.txt"],
      schemaVersion: 2,
    });

    const serialized = serializeReviewScopePolicy(policy);
    expect(serialized).not.toContain(".env.production");
    expect(serialized).not.toContain("super-secret");
    expect(parseReviewScopePolicy(serialized)).toEqual(policy);
  });

  it("injects exact exclusions before the search root separator", () => {
    expect(
      withReviewScopeSearchExclusions(["rg", "--json", "--", "needle", "."], {
        additionalExcludes: ["*.lock", "docs/**"],
        deniedPaths: ["config.txt", "dir/a[1].ts"],
        schemaVersion: 2,
      }),
    ).toEqual([
      "rg",
      "--json",
      "--glob",
      "!config.txt",
      "--glob",
      "!dir/a\\[1\\].ts",
      "--glob",
      "!*.lock",
      "--glob",
      "!docs/**",
      "--",
      "needle",
      ".",
    ]);
  });

  it("fails closed on malformed or sensitive persisted policy paths", () => {
    expect(() =>
      parseReviewScopePolicy(
        JSON.stringify({
          additionalExcludes: [],
          deniedPaths: [".env.production"],
          schemaVersion: 2,
        }),
      ),
    ).toThrow("reviewable destinations");
  });

  it("enforces path allowance with assertReviewScopePathAllowed", () => {
    const policy = {
      additionalExcludes: ["vendor/**"],
      deniedPaths: ["secret.txt"],
      schemaVersion: 2 as const,
    };

    expect(() => assertReviewScopePathAllowed(policy, "secret.txt")).toThrow(
      "excluded by the run policy",
    );
    expect(() =>
      assertReviewScopePathAllowed(policy, "vendor/lib/util.js"),
    ).toThrow("excluded by repository policy");
    expect(() =>
      assertReviewScopePathAllowed(policy, "src/index.ts"),
    ).not.toThrow();
  });

  it("handles ast-grep and edge cases in withReviewScopeSearchExclusions", () => {
    const policy = {
      additionalExcludes: ["vendor/**"],
      deniedPaths: ["secret.txt"],
      schemaVersion: 2 as const,
    };

    expect(
      withReviewScopeSearchExclusions(
        ["ast-grep", "scan", "--", "pattern"],
        policy,
      ),
    ).toEqual([
      "ast-grep",
      "scan",
      "--globs",
      "!secret.txt",
      "--globs",
      "!vendor/**",
      "--",
      "pattern",
    ]);

    // No exclusions returns argv unmodified
    const emptyPolicy = {
      additionalExcludes: [],
      deniedPaths: [],
      schemaVersion: 2 as const,
    };
    expect(
      withReviewScopeSearchExclusions(["rg", "--", "pattern"], emptyPolicy),
    ).toEqual(["rg", "--", "pattern"]);

    // Unsupported tool
    expect(() =>
      withReviewScopeSearchExclusions(["grep", "--", "pattern"], policy),
    ).toThrow("trusted search tool");

    // Missing separator
    expect(() =>
      withReviewScopeSearchExclusions(["rg", "pattern"], policy),
    ).toThrow("missing its argument separator");
  });

  it("rejects invalid json or invalid types in parseReviewScopePolicy", () => {
    expect(() => parseReviewScopePolicy("not json")).toThrow("valid JSON");
    expect(() => parseReviewScopePolicy(JSON.stringify(null))).toThrow(
      "must be an object",
    );
    expect(() =>
      parseReviewScopePolicy(JSON.stringify({ schemaVersion: 99 })),
    ).toThrow("unsupported schemaVersion");
    expect(() =>
      parseReviewScopePolicy(
        JSON.stringify({
          additionalExcludes: "not-an-array",
          deniedPaths: [],
          schemaVersion: 2,
        }),
      ),
    ).toThrow("invalid shape");
  });
});
