import { describe, expect, it } from "vitest";

import {
  buildPublicationMarker,
  classifyFindingPublication,
  createFinding,
  filterChangedLinesByPath,
  isChangedLine,
  type ChangedLine,
} from "../src/index.js";

const changedLines: readonly ChangedLine[] = [
  { line: 10, path: "src/example.ts", side: "RIGHT" },
  { line: 12, path: "src/example.ts", side: "RIGHT" },
];

describe("review findings", () => {
  it("accepts a causal, evidenced finding anchored to the current diff", () => {
    const finding = createFinding(
      {
        confidence: 0.92,
        diagnostic:
          "The caller still passes two arguments, so the new contract fails at runtime.",
        evidence: [
          {
            excerpt: "parse(value, options)",
            path: "src/caller.ts",
            reason: "This unchanged caller uses the removed parameter.",
            startLine: 30,
          },
        ],
        location: { line: 10, path: "src/example.ts", side: "RIGHT" },
        severity: "high",
        suggestion:
          "Update the caller or preserve the previous function contract.",
      },
      changedLines,
    );

    expect(finding.diagnostic).toContain("fails at runtime");
    expect(classifyFindingPublication(finding)).toBe("inline");
    expect(isChangedLine(finding.location, changedLines)).toBe(true);
  });

  it("keeps low severity findings out of inline comments", () => {
    const finding = createFinding(
      {
        confidence: 0.99,
        diagnostic:
          "The error message omits the rejected value, making diagnosis slower.",
        evidence: [
          {
            excerpt: "throw new Error()",
            path: "src/example.ts",
            reason: "Observed in the diff",
            startLine: 10,
          },
        ],
        location: { line: 10, path: "src/example.ts", side: "RIGHT" },
        severity: "low",
      },
      changedLines,
    );

    expect(classifyFindingPublication(finding)).toBe("summary_only");
  });

  it.each([
    { override: { confidence: 1.1 }, reason: "confidence" },
    { override: { diagnostic: "Formatting preference" }, reason: "diagnostic" },
    { override: { evidence: [] }, reason: "evidence" },
    {
      override: {
        location: { line: 11, path: "src/example.ts", side: "RIGHT" as const },
      },
      reason: "location",
    },
  ])("rejects a finding with invalid $reason", ({ override }) => {
    expect(() =>
      createFinding(
        {
          confidence: 0.9,
          diagnostic: "This change breaks the documented response contract.",
          evidence: [
            {
              excerpt: "return null",
              path: "src/example.ts",
              reason: "Observed behavior",
              startLine: 10,
            },
          ],
          location: { line: 10, path: "src/example.ts", side: "RIGHT" },
          severity: "medium",
          ...override,
        },
        changedLines,
      ),
    ).toThrow();
  });

  it("creates a deterministic, versioned and invisible publication marker", () => {
    const marker = buildPublicationMarker(
      `github:42:pr:7:head:${"a".repeat(40)}`,
      `finding:${"b".repeat(64)}`,
    );

    expect(marker).toBe(
      `<!-- holon:v1;run=github%3A42%3Apr%3A7%3Ahead%3A${"a".repeat(40)};finding=finding%3A${"b".repeat(64)} -->`,
    );
  });

  it("rejects an inverted multiline finding range", () => {
    expect(() =>
      createFinding(
        {
          confidence: 0.9,
          diagnostic:
            "The changed block violates the response contract used by callers.",
          evidence: [
            {
              excerpt: "return null",
              path: "src/example.ts",
              reason: "Observed behavior",
              startLine: 10,
            },
          ],
          location: {
            line: 10,
            path: "src/example.ts",
            side: "RIGHT",
            startLine: 11,
          },
          severity: "medium",
        },
        changedLines,
      ),
    ).toThrow("startLine");
  });

  it("filters changed lines by file path deterministically", () => {
    const mixedChangedLines: readonly ChangedLine[] = [
      { line: 10, path: "src/a.ts", side: "RIGHT" },
      { line: 20, path: "src/b.ts", side: "RIGHT" },
      { line: 30, path: "src/a.ts", side: "RIGHT" },
    ];
    expect(filterChangedLinesByPath(mixedChangedLines, "src/a.ts")).toEqual([
      { line: 10, path: "src/a.ts", side: "RIGHT" },
      { line: 30, path: "src/a.ts", side: "RIGHT" },
    ]);
    expect(filterChangedLinesByPath(mixedChangedLines, "src/c.ts")).toEqual([]);
  });
});
