import { expect, it } from "vitest";

import {
  calculateChangedLinesCoverage,
  formatCiEvidenceMarkdown,
} from "../src/ci-evidence.js";
it("merges coverage observations independent of arrival order", () => {
  const changes = [{ path: "a.ts", line: 1, side: "RIGHT" as const }];
  const reports = [
    { path: "a.ts", hitsByLine: { 1: 0 }, totalFound: 1, totalHit: 0 },
    { path: "a.ts", hitsByLine: { 1: 1 }, totalFound: 1, totalHit: 1 },
  ];
  expect(
    calculateChangedLinesCoverage(changes, reports).coveragePercentage,
  ).toBe(100);
  expect(
    calculateChangedLinesCoverage(changes, reports.toReversed())
      .coveragePercentage,
  ).toBe(100);
});
it("escapes untrusted CI content and redacts credentials", () => {
  const rendered = formatCiEvidenceMarkdown({
    status: "partial",
    tests: {
      passed: 0,
      failed: 1,
      skipped: 0,
      total: 1,
      failures: [
        {
          testName: "**injected**",
          message: '\u001b[31mtoken="abcdefghijk123456789"\u001b[0m',
        },
      ],
    },
  });
  expect(rendered).not.toContain("abcdefghijk123456789");
  expect(rendered).not.toContain("\u001b");
  expect(rendered).toContain("\\*\\*injected\\*\\*");
});
