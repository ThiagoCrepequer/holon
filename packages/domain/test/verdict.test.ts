import { describe, expect, it } from "vitest";

import type { FindingCandidate } from "../src/finding.js";
import { determineReviewVerdict, formatVerdictBadge } from "../src/verdict.js";

function makeFinding(
  severity: "critical" | "high" | "medium" | "low",
  confidence = 0.85,
  diagnostic = "Diagnostic message",
): FindingCandidate {
  return {
    confidence,
    diagnostic,
    evidence: [
      {
        excerpt: "const a = 1;",
        path: "src/index.ts",
        reason: "evidence reason",
        startLine: 1,
      },
    ],
    location: {
      line: 1,
      path: "src/index.ts",
      side: "RIGHT",
    },
    severity,
  };
}

describe("determineReviewVerdict", () => {
  describe("incomplete scope and fail-safe cases (COMMENT)", () => {
    it("returns COMMENT when scopeStatus is partial_by_policy", () => {
      const result = determineReviewVerdict({
        findings: [makeFinding("critical")],
        scopeStatus: "partial_by_policy",
      });
      expect(result.verdict).toBe("COMMENT");
      expect(result.reasons[0]).toContain("Review scope is partial");
    });

    it("returns COMMENT when scopeStatus is partial_by_failure", () => {
      const result = determineReviewVerdict({
        findings: [],
        scopeStatus: "partial_by_failure",
      });
      expect(result.verdict).toBe("COMMENT");
      expect(result.reasons[0]).toContain("Review was interrupted");
    });

    it("returns COMMENT when scopeStatus is unsupported", () => {
      const result = determineReviewVerdict({
        findings: [],
        scopeStatus: "unsupported",
      });
      expect(result.verdict).toBe("COMMENT");
      expect(result.reasons[0]).toContain("no supported code changes");
    });

    it("returns COMMENT when shardsAnalyzed < totalShards", () => {
      const result = determineReviewVerdict({
        findings: [],
        scopeStatus: "complete",
        shardsAnalyzed: 1,
        totalShards: 2,
      });
      expect(result.verdict).toBe("COMMENT");
      expect(result.reasons[0]).toContain("Incomplete shard execution");
    });

    it("returns COMMENT when all detected findings have confidence below minimum threshold", () => {
      const lowConfidenceFinding = makeFinding("critical", 0.6);
      const result = determineReviewVerdict({
        findings: [lowConfidenceFinding],
        scopeStatus: "complete",
        shardsAnalyzed: 1,
        totalShards: 1,
      });
      expect(result.verdict).toBe("COMMENT");
      expect(result.reasons[0]).toContain("below the reliable threshold");
    });
  });

  describe("blocking defects (REQUEST_CHANGES)", () => {
    it("returns REQUEST_CHANGES on a single critical finding", () => {
      const criticalFinding = makeFinding("critical", 0.9);
      const result = determineReviewVerdict({
        findings: [criticalFinding],
        scopeStatus: "complete",
        shardsAnalyzed: 1,
        totalShards: 1,
      });
      expect(result.verdict).toBe("REQUEST_CHANGES");
      expect(result.blockingFindingsCount).toBe(1);
      expect(result.reasons[0]).toContain("1 critical defect(s) identified");
    });

    it("returns REQUEST_CHANGES on a single high severity finding", () => {
      const highFinding = makeFinding("high", 0.85);
      const result = determineReviewVerdict({
        findings: [highFinding],
        scopeStatus: "complete",
        shardsAnalyzed: 1,
        totalShards: 1,
      });
      expect(result.verdict).toBe("REQUEST_CHANGES");
      expect(result.blockingFindingsCount).toBe(1);
      expect(result.reasons[0]).toContain(
        "1 high-severity defect(s) identified",
      );
    });

    it("returns REQUEST_CHANGES on a single medium finding with high confidence (>= 0.85)", () => {
      const highConfidenceMedium = makeFinding("medium", 0.88);
      const result = determineReviewVerdict({
        findings: [highConfidenceMedium],
        scopeStatus: "complete",
        shardsAnalyzed: 1,
        totalShards: 1,
      });
      expect(result.verdict).toBe("REQUEST_CHANGES");
      expect(result.blockingFindingsCount).toBe(1);
      expect(result.reasons[0]).toContain("high-confidence moderate defect(s)");
    });

    it("returns REQUEST_CHANGES on accumulation of medium findings (>= 2)", () => {
      const medium1 = makeFinding("medium", 0.8);
      const medium2 = makeFinding("medium", 0.8);
      const result = determineReviewVerdict({
        findings: [medium1, medium2],
        scopeStatus: "complete",
        shardsAnalyzed: 1,
        totalShards: 1,
      });
      expect(result.verdict).toBe("REQUEST_CHANGES");
      expect(result.blockingFindingsCount).toBe(2);
      expect(result.reasons[0]).toContain("2 moderate defects accumulated");
    });

    it("returns REQUEST_CHANGES when risk score exceeds threshold", () => {
      // 1 medium (1.5) with confidence 0.8 + 3 low (0.75) = 2.25 >= 2.0
      const medium = makeFinding("medium", 0.8);
      const low1 = makeFinding("low", 0.8);
      const low2 = makeFinding("low", 0.8);
      const low3 = makeFinding("low", 0.8);
      const result = determineReviewVerdict({
        findings: [medium, low1, low2, low3],
        scopeStatus: "complete",
        shardsAnalyzed: 1,
        totalShards: 1,
      });
      expect(result.verdict).toBe("REQUEST_CHANGES");
      expect(result.riskScore).toBeGreaterThanOrEqual(2.0);
    });
  });

  describe("approvals (APPROVE)", () => {
    it("returns APPROVE when no findings exist on complete review", () => {
      const result = determineReviewVerdict({
        findings: [],
        scopeStatus: "complete",
        shardsAnalyzed: 2,
        totalShards: 2,
      });
      expect(result.verdict).toBe("APPROVE");
      expect(result.blockingFindingsCount).toBe(0);
      expect(result.advisoryFindingsCount).toBe(0);
      expect(result.reasons[0]).toContain("All reviewed files clean");
    });

    it("returns COMMENT when review is degraded instead of approving", () => {
      const result = determineReviewVerdict({
        findings: [],
        isDegraded: true,
        scopeStatus: "complete",
        shardsAnalyzed: 1,
        totalShards: 1,
      });
      expect(result.verdict).toBe("COMMENT");
      expect(result.reasons[0]).toContain("The review is incomplete");
      expect(result.reasons[0]).not.toContain("All reviewed files clean");
    });

    it("returns APPROVE when only low severity advisory findings exist", () => {
      const low1 = makeFinding("low", 0.85);
      const low2 = makeFinding("low", 0.9);
      const result = determineReviewVerdict({
        findings: [low1, low2],
        scopeStatus: "complete",
        shardsAnalyzed: 1,
        totalShards: 1,
      });
      expect(result.verdict).toBe("APPROVE");
      expect(result.blockingFindingsCount).toBe(0);
      expect(result.advisoryFindingsCount).toBe(2);
      expect(result.reasons[0]).toContain(
        "2 non-blocking observation(s) provided",
      );
    });

    it("returns COMMENT when allowApprove is false even if review is clean", () => {
      const result = determineReviewVerdict({
        findings: [],
        options: { allowApprove: false },
        scopeStatus: "complete",
        shardsAnalyzed: 1,
        totalShards: 1,
      });
      expect(result.verdict).toBe("COMMENT");
      expect(result.reasons[0]).toContain("automated approvals are disabled");
    });
  });

  describe("formatVerdictBadge", () => {
    it("formats markdown badges correctly", () => {
      expect(formatVerdictBadge("APPROVE")).toBe("### Verdict: Approved");
      expect(formatVerdictBadge("REQUEST_CHANGES")).toBe(
        "### Verdict: Changes requested",
      );
      expect(formatVerdictBadge("COMMENT")).toBe(
        "### Verdict: Informational Comment",
      );
    });
  });
});
