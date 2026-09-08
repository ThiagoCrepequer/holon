import { expect, it } from "vitest";

import {
  reviewContextV3Schema,
  reviewContextV4Schema,
} from "../src/executor.js";

const context = {
  schemaVersion: 4,
  changedLines: [],
  files: Array.from({ length: 5 }, (_, i) => ({
    path: `src/module${i}.ts`,
    mode: "structural",
    patch: "語".repeat(20_000),
  })),
  effectivePolicyDigest: "c".repeat(64),
  policySource: "default",
  sourceDigest: null,
  verdictStrictness: "default",
  waiversCount: 0,
  truncated: false,
};
it("accepts 300 kB of complete planned patches only under context V4", () => {
  expect(reviewContextV4Schema.safeParse(context).success).toBe(true);
  expect(
    reviewContextV3Schema.safeParse({ ...context, schemaVersion: 3 }).success,
  ).toBe(false);
  expect(
    reviewContextV4Schema.safeParse({ ...context, schemaVersion: 3 }).success,
  ).toBe(false);
});
it("counts UTF-8 bytes for aggregate and individual patch limits", () => {
  expect(
    reviewContextV4Schema.safeParse({
      ...context,
      files: [
        ...context.files,
        { path: "src/extra.ts", mode: "structural", patch: "x" },
      ],
    }).success,
  ).toBe(false);
  expect(
    reviewContextV4Schema.safeParse({
      ...context,
      files: [{ ...context.files[0], patch: "語".repeat(20_000) + "x" }],
    }).success,
  ).toBe(false);
});
