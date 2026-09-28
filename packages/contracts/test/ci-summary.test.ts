import { describe, expect, it } from "vitest";

import { ciSummarySchema, truncateUtf8Bytes } from "../src/index.js";

it("validates the CI summary independently of an administrative DTO", () => {
  const ci = {
    durationMs: 45000,
    failed: 0,
    passed: 120,
    skipped: 2,
    status: "available",
    total: 122,
    workflowName: "CI Test Suite",
  };
  expect(ciSummarySchema.parse(ci)).toEqual(ci);
});

// These cases remain necessary for CI publication after removing the admin DTO.
describe("truncateUtf8Bytes", () => {
  it("leaves strings within the budget unchanged", () => {
    expect(truncateUtf8Bytes("hello world", 20)).toBe("hello world");
  });
  it.each([
    ["hello world! this is long text", 15, "hello world!…"],
    ["café delícia", 8, "café…"],
    ["test 🚀 rocket 🔥 fire", 12, "test 🚀…"],
    ["long", 2, ""],
  ] as const)(
    "bounds %s to %i bytes without breaking Unicode",
    (input, limit, expected) => {
      const truncated = truncateUtf8Bytes(input, limit);
      expect(truncated).toBe(expected);
      expect(
        new TextEncoder().encode(truncated).byteLength,
      ).toBeLessThanOrEqual(limit);
      expect(truncated).not.toContain("\uFFFD");
    },
  );
});
