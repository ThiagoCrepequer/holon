import { expect, it } from "vitest";

import {
  isProjectMetadataPathAllowed,
  classifyReviewPath,
} from "../src/review-path-policy.js";
it("only exempts metadata lockfiles, not secret or excluded directories", () => {
  expect(classifyReviewPath("pnpm-lock.yaml")).toBeUndefined();
  expect(isProjectMetadataPathAllowed("pnpm-lock.yaml", [])).toBe(true);
  for (const path of [
    "node_modules/pnpm-lock.yaml",
    "vendor/package-lock.json",
    ".env",
    "../package.json",
    "a\\package.json",
  ])
    expect(isProjectMetadataPathAllowed(path, [])).toBe(false);
  expect(
    isProjectMetadataPathAllowed("api/package-lock.json", ["api/**"]),
  ).toBe(false);
});
