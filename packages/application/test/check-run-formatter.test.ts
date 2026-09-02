import type { Finding } from "@holon/domain";
import { describe, expect, it } from "vitest";

import {
  determineCheckRunConclusion,
  formatCheckRunOutput,
} from "../src/index.js";

const sampleFinding: Finding = {
  confidence: 0.9,
  diagnostic: "The contract was violated.",
  evidence: [
    {
      excerpt: "call()",
      path: "src/index.ts",
      reason: "Observed regression",
      startLine: 10,
    },
  ],
  location: { line: 10, path: "src/index.ts", side: "RIGHT" },
  severity: "high",
};

describe("check-run-formatter", () => {
  it("determines conclusion based on findings and partiality", () => {
    expect(determineCheckRunConclusion([])).toBe("success");
    expect(determineCheckRunConclusion([], false)).toBe("success");
    expect(determineCheckRunConclusion([], true)).toBe("neutral");
    expect(determineCheckRunConclusion([sampleFinding], false)).toBe("neutral");
    expect(determineCheckRunConclusion([sampleFinding], true)).toBe("neutral");
    expect(
      determineCheckRunConclusion([sampleFinding], false, "REQUEST_CHANGES"),
    ).toBe("failure");
    expect(determineCheckRunConclusion([], false, "APPROVE")).toBe("success");
    expect(determineCheckRunConclusion([sampleFinding], true, "COMMENT")).toBe(
      "neutral",
    );
  });

  it("formats check run output for successful clean review", () => {
    const output = formatCheckRunOutput({
      durationMs: 1250,
      fileCount: 4,
      findings: [],
      partial: false,
      summary: "No functional regressions or security issues found.",
    });

    expect(output.title).toBe("Holon Review — No regressions found");
    expect(output.summary).toContain(
      "No functional regressions or security issues found.",
    );
    expect(output.summary).toContain("- **Files analyzed**: 4");
    expect(output.summary).toContain("- **Findings identified**: 0");
    expect(output.summary).toContain("- **Duration**: 1.25s");
    expect(output.summary).not.toContain("- **Scope**: Partial");
  });

  it("formats check run output with findings and partial status", () => {
    const outputSingle = formatCheckRunOutput({
      durationMs: 2500,
      fileCount: 2,
      findings: [sampleFinding],
      summary: "One regression identified.",
    });
    expect(outputSingle.title).toBe("Holon Review — 1 finding identified");
    expect(outputSingle.summary).toContain("- **Findings identified**: 1");

    const outputMultiple = formatCheckRunOutput({
      durationMs: 3000,
      fileCount: 5,
      findings: [sampleFinding, sampleFinding],
      partial: true,
      summary: "Multiple issues identified.",
    });
    expect(outputMultiple.title).toBe("Holon Review — 2 findings identified");
    expect(outputMultiple.summary).toContain("- **Scope**: Partial");

    const outputPartialNoFindings = formatCheckRunOutput({
      findings: [],
      partial: true,
      summary: "No issues in analyzed subset.",
    });
    expect(outputPartialNoFindings.title).toBe(
      "Holon Review — Partial review completed",
    );

    const outputApproved = formatCheckRunOutput({
      findings: [],
      summary: "All clean.",
      verdict: "APPROVE",
    });
    expect(outputApproved.title).toBe("Holon Review — Approved");

    const outputRequestedChanges = formatCheckRunOutput({
      findings: [sampleFinding],
      summary: "Defect found.",
      verdict: "REQUEST_CHANGES",
    });
    expect(outputRequestedChanges.title).toBe(
      "Holon Review — Changes requested (1 finding)",
    );

    const outputApprovedWithResolutions = formatCheckRunOutput({
      findings: [],
      reconciliation: {
        newCount: 0,
        obsoleteCount: 0,
        persistentCount: 0,
        reintroducedCount: 0,
        resolvedCount: 2,
        totalActiveCount: 0,
      },
      summary: "All 2 previously reported issues have been resolved.",
      verdict: "APPROVE",
    });
    expect(outputApprovedWithResolutions.title).toBe(
      "Holon Review — Approved (2 resolved)",
    );
    expect(outputApprovedWithResolutions.summary).toContain(
      "- **Lifecycle**: 2 resolved, 0 persistent, 0 new",
    );

    const outputComment = formatCheckRunOutput({
      findings: [],
      summary: "Informational notes.",
      verdict: "COMMENT",
    });
    expect(outputComment.title).toBe("Holon Review — Informational comment");
  });
});
