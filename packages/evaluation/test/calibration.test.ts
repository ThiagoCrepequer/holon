import type { FindingFeedbackRecord, TrackedFinding } from "@holon/contracts";
import { describe, expect, it } from "vitest";

import {
  computeCalibrationMetrics,
  promoteFeedbackToCalibrationCase,
} from "../src/calibration.js";

const fp1 =
  "fp:1111111111111111111111111111111111111111111111111111111111111111";
const fp2 =
  "fp:2222222222222222222222222222222222222222222222222222222222222222";

describe("calibration metrics", () => {
  it("computes false positive rates and utility rates accurately", () => {
    const feedbacks: FindingFeedbackRecord[] = [
      {
        authorLogin: "alice",
        createdAt: "2026-09-02T10:00:00.000Z",
        fingerprint: fp1,
        label: "false_positive",
        prKey: "github:42:pr:7",
        reason: "Invariant checked upstream",
      },
      {
        authorLogin: "bob",
        createdAt: "2026-09-02T10:01:00.000Z",
        fingerprint: fp1,
        label: "not_actionable",
        prKey: "github:42:pr:7",
      },
      {
        authorLogin: "carol",
        createdAt: "2026-09-02T10:02:00.000Z",
        fingerprint: fp2,
        label: "helpful",
        prKey: "github:42:pr:7",
      },
      {
        authorLogin: "dave",
        createdAt: "2026-09-02T10:03:00.000Z",
        fingerprint: fp2,
        label: "wrong_severity",
        prKey: "github:42:pr:7",
        targetSeverity: "low",
      },
    ];

    const metrics = computeCalibrationMetrics(feedbacks, 10);
    expect(metrics.totalFeedbacks).toBe(4);
    expect(metrics.falsePositiveCount).toBe(2);
    expect(metrics.helpfulCount).toBe(1);
    expect(metrics.wrongSeverityCount).toBe(1);
    expect(metrics.totalReviewedFindings).toBe(10);
    expect(metrics.falsePositiveRate).toBe(0.2);
    expect(metrics.utilityRate).toBe(0.25);
  });

  it("handles empty feedback sets without zero-division", () => {
    const metrics = computeCalibrationMetrics([], 0);
    expect(metrics.falsePositiveCount).toBe(0);
    expect(metrics.falsePositiveRate).toBe(0);
    expect(metrics.helpfulCount).toBe(0);
    expect(metrics.utilityRate).toBe(0);
    expect(metrics.totalFeedbacks).toBe(0);
  });

  it("promotes feedback to a calibration candidate case", () => {
    const finding: TrackedFinding = {
      diagnostic: "Possible SQL injection detected in raw query",
      filePath: "src/database.ts",
      fingerprint: fp1,
      firstSeenHeadSha: "a".repeat(40),
      firstSeenRunId: `github:42:pr:7:head:${"a".repeat(40)}`,
      lastSeenHeadSha: "a".repeat(40),
      lastSeenRunId: `github:42:pr:7:head:${"a".repeat(40)}`,
      line: 45,
      prKey: "github:42:pr:7",
      severity: "critical",
      status: "dismissed",
      updatedAt: "2026-09-02T10:00:00.000Z",
    };

    const fb: FindingFeedbackRecord = {
      authorLogin: "alice",
      createdAt: "2026-09-02T10:05:00.000Z",
      fingerprint: fp1,
      label: "false_positive",
      prKey: "github:42:pr:7",
      reason: "Query uses parameterized statement internally",
    };

    const candidate = promoteFeedbackToCalibrationCase(fb, finding);
    expect(candidate.expectedVerdict).toBe("APPROVE");
    expect(candidate.feedbackLabel).toBe("false_positive");
    expect(candidate.filePath).toBe("src/database.ts");
    expect(candidate.reason).toBe(
      "Query uses parameterized statement internally",
    );
  });
});
