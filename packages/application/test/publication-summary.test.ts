import { expect, it } from "vitest";

import { fitPublicationSummary } from "../src/publication-summary.js";

it("retains long narratives without losing coverage and lifecycle notices", () => {
  const suffix =
    "Partial review: model generation reached its limit.\nLifecycle: 1 issue resolved.";
  const body = fitPublicationSummary(
    "Verdict: COMMENT",
    "😀".repeat(20_000),
    suffix,
  );
  expect(body.startsWith("Verdict: COMMENT")).toBe(true);
  expect(body.endsWith(suffix)).toBe(true);
  expect(body).toContain("publication budget");
  expect(body.length).toBeLessThanOrEqual(16_000);
  expect(new TextEncoder().encode(body).byteLength).toBeLessThan(60_000);
  expect(body.isWellFormed()).toBe(true);
  expect(fitPublicationSummary("", "a".repeat(8_000), "")).toBe(
    "a".repeat(8_000),
  );
});
