import { describe, expect, it } from "vitest";

import {
  applyFeedbackToFindings,
  isAuthorizedFeedbackAuthor,
  isDismissalFeedback,
  parseFeedbackCommand,
  type FindingFeedbackRecord,
} from "../src/feedback.js";
import type { FindingFingerprint, PrKey, RunId } from "../src/identity.js";
import { reconcileFindings, type TrackedFinding } from "../src/lifecycle.js";

const prKey: PrKey = "github:42:pr:7";
const runId1: RunId =
  "github:42:pr:7:head:1111111111111111111111111111111111111111";
const runId2: RunId =
  "github:42:pr:7:head:2222222222222222222222222222222222222222";
const fp1: FindingFingerprint =
  "fp:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const fp2: FindingFingerprint =
  "fp:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("parseFeedbackCommand", () => {
  it("parses false-positive dismissal with and without reason", () => {
    expect(parseFeedbackCommand("/holon dismiss false-positive")).toEqual({
      label: "false_positive",
      reason: undefined,
    });

    expect(
      parseFeedbackCommand(
        "/holon dismiss false-positive: Invariant enforced by caller",
      ),
    ).toEqual({
      label: "false_positive",
      reason: "Invariant enforced by caller",
    });

    expect(
      parseFeedbackCommand(
        "/holon dismiss false_positive - Known limitation in tests",
      ),
    ).toEqual({
      label: "false_positive",
      reason: "Known limitation in tests",
    });
  });

  it("parses not-actionable dismissal with reason", () => {
    expect(
      parseFeedbackCommand("/holon dismiss not-actionable Out of scope for PR"),
    ).toEqual({
      label: "not_actionable",
      reason: "Out of scope for PR",
    });

    expect(parseFeedbackCommand("/holon dismiss not_actionable")).toEqual({
      label: "not_actionable",
      reason: undefined,
    });
  });

  it("parses wrong-severity dismissal with explicit and default target severities", () => {
    expect(
      parseFeedbackCommand(
        "/holon dismiss wrong-severity:low: Typo in comments is cosmetic",
      ),
    ).toEqual({
      label: "wrong_severity",
      reason: "Typo in comments is cosmetic",
      targetSeverity: "low",
    });

    expect(
      parseFeedbackCommand(
        "/holon dismiss wrong-severity:critical Major memory leak",
      ),
    ).toEqual({
      label: "wrong_severity",
      reason: "Major memory leak",
      targetSeverity: "critical",
    });

    expect(parseFeedbackCommand("/holon dismiss wrong-severity")).toEqual({
      label: "wrong_severity",
      reason: undefined,
      targetSeverity: "low",
    });
  });

  it("parses duplicate dismissal", () => {
    expect(
      parseFeedbackCommand(
        "/holon dismiss duplicate: Already caught by ESLint rule",
      ),
    ).toEqual({
      label: "duplicate",
      reason: "Already caught by ESLint rule",
    });
  });

  it("parses helpful feedback commands and emojis", () => {
    expect(
      parseFeedbackCommand("/holon helpful Good catch on null check"),
    ).toEqual({
      label: "helpful",
      reason: "Good catch on null check",
    });

    expect(parseFeedbackCommand("/holon accept")).toEqual({
      label: "helpful",
      reason: undefined,
    });

    expect(parseFeedbackCommand("👍")).toEqual({
      label: "helpful",
      reason: undefined,
    });

    expect(parseFeedbackCommand("+1 Thanks!")).toEqual({
      label: "helpful",
      reason: "Thanks!",
    });
  });

  it("parses missed-defect command with coordinates", () => {
    expect(
      parseFeedbackCommand(
        "/holon missed-defect src/auth.ts:42: Missing rate limiting on login route",
      ),
    ).toEqual({
      label: "missed_defect",
      line: 42,
      path: "src/auth.ts",
      reason: "Missing rate limiting on login route",
    });
  });

  it("returns undefined for unrecognized commands or arbitrary comments", () => {
    expect(parseFeedbackCommand("")).toBeUndefined();
    expect(parseFeedbackCommand("   ")).toBeUndefined();
    expect(parseFeedbackCommand("Why did you flag this line?")).toBeUndefined();
    expect(parseFeedbackCommand("/holon unknown-command")).toBeUndefined();
  });
});

describe("isDismissalFeedback", () => {
  it("identifies dismissal categories correctly", () => {
    expect(isDismissalFeedback("false_positive")).toBe(true);
    expect(isDismissalFeedback("not_actionable")).toBe(true);
    expect(isDismissalFeedback("duplicate")).toBe(true);
    expect(isDismissalFeedback("thread_resolved")).toBe(true);

    expect(isDismissalFeedback("helpful")).toBe(false);
    expect(isDismissalFeedback("wrong_severity")).toBe(false);
    expect(isDismissalFeedback("missed_defect")).toBe(false);
  });
});

describe("applyFeedbackToFindings", () => {
  const baseFinding: TrackedFinding = {
    diagnostic: "Potential SQL injection vulnerability in query builder",
    filePath: "src/db.ts",
    fingerprint: fp1,
    firstSeenHeadSha: "1111111111111111111111111111111111111111",
    firstSeenRunId: runId1,
    githubCommentId: 101,
    lastSeenHeadSha: "1111111111111111111111111111111111111111",
    lastSeenRunId: runId1,
    line: 55,
    prKey,
    severity: "critical",
    status: "new",
    updatedAt: "2026-09-02T10:00:00.000Z",
  };

  it("marks finding as dismissed when false_positive feedback is present", () => {
    const feedbacks: FindingFeedbackRecord[] = [
      {
        authorLogin: "alice",
        createdAt: "2026-09-02T10:05:00.000Z",
        fingerprint: fp1,
        label: "false_positive",
        prKey,
        reason: "Input is already sanitized by ORM layer",
      },
    ];

    const updated = applyFeedbackToFindings([baseFinding], feedbacks);
    expect(updated[0]?.status).toBe("dismissed");
    expect(updated[0]?.severity).toBe("critical");
  });

  it("updates severity when wrong_severity feedback is present", () => {
    const feedbacks: FindingFeedbackRecord[] = [
      {
        authorLogin: "bob",
        createdAt: "2026-09-02T10:05:00.000Z",
        fingerprint: fp1,
        label: "wrong_severity",
        prKey,
        targetSeverity: "low",
      },
    ];

    const updated = applyFeedbackToFindings([baseFinding], feedbacks);
    expect(updated[0]?.status).toBe("new");
    expect(updated[0]?.severity).toBe("low");
  });

  it("does not mutate findings if no feedback matches", () => {
    const feedbacks: FindingFeedbackRecord[] = [
      {
        authorLogin: "bob",
        createdAt: "2026-09-02T10:05:00.000Z",
        fingerprint: fp2,
        label: "false_positive",
        prKey,
      },
    ];

    const updated = applyFeedbackToFindings([baseFinding], feedbacks);
    expect(updated[0]).toBe(baseFinding);
  });
});

describe("reconcileFindings with dismissed state", () => {
  it("preserves dismissed status across subsequent commits without adding to active findings", () => {
    const dismissedBaseline: TrackedFinding = {
      diagnostic: "Potential SQL injection vulnerability in query builder",
      filePath: "src/db.ts",
      fingerprint: fp1,
      firstSeenHeadSha: "1111111111111111111111111111111111111111",
      firstSeenRunId: runId1,
      githubCommentId: 101,
      lastSeenHeadSha: "1111111111111111111111111111111111111111",
      lastSeenRunId: runId1,
      line: 55,
      prKey,
      severity: "critical",
      status: "dismissed",
      updatedAt: "2026-09-02T10:00:00.000Z",
    };

    const currentFinding = {
      confidence: 0.95,
      diagnostic: "Potential SQL injection vulnerability in query builder",
      evidence: [
        {
          excerpt: "query(rawSql)",
          path: "src/db.ts",
          reason: "Unescaped string interpolation",
          startLine: 60,
        },
      ],
      fingerprint: fp1,
      location: { line: 60, path: "src/db.ts", side: "RIGHT" as const },
      severity: "critical" as const,
    };

    const result = reconcileFindings({
      baselineFindings: [dismissedBaseline],
      coverage: {
        isComplete: true,
        pullRequestFiles: ["src/db.ts"],
        reviewedFiles: ["src/db.ts"],
      },
      currentFindings: [currentFinding],
      currentHeadSha: "2222222222222222222222222222222222222222",
      currentRunId: runId2,
      prKey,
      timestamp: "2026-09-02T11:00:00.000Z",
    });

    // It must NOT be in active findings (so it does not block review approval!)
    expect(result.activeFindings).toHaveLength(0);
    // It must be placed in dismissed findings
    expect(result.dismissedFindings).toHaveLength(1);
    expect(result.dismissedFindings[0]?.status).toBe("dismissed");
    expect(result.summary.dismissedCount).toBe(1);
    expect(result.summary.totalActiveCount).toBe(0);

    // It must remain updated as dismissed in tracked findings
    const updated = result.updatedTrackedFindings.find(
      (f) => f.fingerprint === fp1,
    );
    expect(updated?.status).toBe("dismissed");
    expect(updated?.line).toBe(60);
    expect(updated?.lastSeenHeadSha).toBe(
      "2222222222222222222222222222222222222222",
    );
  });

  describe("isAuthorizedFeedbackAuthor", () => {
    it("authorizes repository owners, members, and collaborators", () => {
      expect(isAuthorizedFeedbackAuthor("OWNER")).toBe(true);
      expect(isAuthorizedFeedbackAuthor("owner")).toBe(true);
      expect(isAuthorizedFeedbackAuthor("MEMBER")).toBe(true);
      expect(isAuthorizedFeedbackAuthor("member")).toBe(true);
      expect(isAuthorizedFeedbackAuthor("COLLABORATOR")).toBe(true);
      expect(isAuthorizedFeedbackAuthor("collaborator")).toBe(true);
    });

    it("rejects unauthorized associations and empty input", () => {
      expect(isAuthorizedFeedbackAuthor("CONTRIBUTOR")).toBe(false);
      expect(isAuthorizedFeedbackAuthor("FIRST_TIME_CONTRIBUTOR")).toBe(false);
      expect(isAuthorizedFeedbackAuthor("FIRST_TIMER")).toBe(false);
      expect(isAuthorizedFeedbackAuthor("MANNEQUIN")).toBe(false);
      expect(isAuthorizedFeedbackAuthor("NONE")).toBe(false);
      expect(isAuthorizedFeedbackAuthor("none")).toBe(false);
      expect(isAuthorizedFeedbackAuthor(undefined)).toBe(false);
      expect(isAuthorizedFeedbackAuthor("")).toBe(false);
    });
  });
});
