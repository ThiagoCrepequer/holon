import { expect, it } from "vitest";

import { reviewContextSchema } from "../src/executor.js";

const context = {
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
it("accepts 300 kB of complete planned patches and rejects retired transport fields", () => {
  expect(reviewContextSchema.safeParse(context).success).toBe(true);
  expect(
    reviewContextSchema.safeParse({ ...context, schemaVersion: 3 }).success,
  ).toBe(false);
});
it("counts UTF-8 bytes for aggregate and individual patch limits", () => {
  expect(
    reviewContextSchema.safeParse({
      ...context,
      files: [
        ...context.files,
        { path: "src/extra.ts", mode: "structural", patch: "x" },
      ],
    }).success,
  ).toBe(false);
  expect(
    reviewContextSchema.safeParse({
      ...context,
      files: [{ ...context.files[0], patch: "語".repeat(20_000) + "x" }],
    }).success,
  ).toBe(false);
});
