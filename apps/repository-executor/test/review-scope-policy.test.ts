import { splitPullRequestDiff } from "@holon/repository-analysis";
import { describe, expect, it } from "vitest";

import {
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
    expect(policy).toEqual({ deniedPaths: ["config.txt"], schemaVersion: 1 });

    const serialized = serializeReviewScopePolicy(policy);
    expect(serialized).not.toContain(".env.production");
    expect(serialized).not.toContain("super-secret");
    expect(parseReviewScopePolicy(serialized)).toEqual(policy);
  });

  it("injects exact exclusions before the search root separator", () => {
    expect(
      withReviewScopeSearchExclusions(["rg", "--json", "--", "needle", "."], {
        deniedPaths: ["config.txt", "dir/a[1].ts"],
        schemaVersion: 1,
      }),
    ).toEqual([
      "rg",
      "--json",
      "--glob",
      "!config.txt",
      "--glob",
      "!dir/a\\[1\\].ts",
      "--",
      "needle",
      ".",
    ]);
  });

  it("fails closed on malformed or sensitive persisted policy paths", () => {
    expect(() =>
      parseReviewScopePolicy(
        JSON.stringify({ deniedPaths: [".env.production"], schemaVersion: 1 }),
      ),
    ).toThrow("reviewable destinations");
    expect(() =>
      parseReviewScopePolicy(
        JSON.stringify({ deniedPaths: ["../outside"], schemaVersion: 1 }),
      ),
    ).toThrow("reviewable destinations");
  });
});
