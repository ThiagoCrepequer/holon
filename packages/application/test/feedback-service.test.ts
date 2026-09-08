import type { TrackedFinding } from "@holon/contracts";
import type { FindingFingerprint, PrKey, RunId } from "@holon/domain";
import { describe, expect, it, vi } from "vitest";

import {
  processFeedbackComment,
  processThreadResolved,
} from "../src/feedback-service.js";
import type {
  AppliedFindingFeedback,
  FeedbackLedger,
  ReviewDecisionContext,
  ReviewPublisher,
} from "../src/ports.js";

const prKey: PrKey = "github:42:pr:7";
const runId: RunId =
  "github:42:pr:7:head:1111111111111111111111111111111111111111";
const fingerprint: FindingFingerprint =
  "fp:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const finding: TrackedFinding = {
  evidenceFingerprint: fingerprint.slice(3),
  confidence: 0.8,
  diagnostic: "Critical vulnerability in authentication layer",
  filePath: "src/auth.ts",
  fingerprint,
  firstSeenHeadSha: "1".repeat(40),
  firstSeenRunId: runId,
  githubCommentId: 101,
  lastSeenHeadSha: "1".repeat(40),
  lastSeenRunId: runId,
  line: 42,
  prKey,
  severity: "critical",
  status: "new",
  updatedAt: "2026-09-02T10:00:00.000Z",
};

const decision: ReviewDecisionContext = {
  checkRunId: 555,
  headSha: "1".repeat(40),
  isDegraded: false,
  runId,
  scopeStatus: "complete",
  shardsAnalyzed: 2,
  totalShards: 2,
};

function application(
  overrides: Partial<AppliedFindingFeedback> = {},
): AppliedFindingFeedback {
  return {
    activeFindings: [],
    decision,
    feedback: {
      authorAssociation: "COLLABORATOR",
      authorLogin: "alice",
      createdAt: "2026-09-02T10:05:00.000Z",
      fingerprint,
      githubCommentId: 202,
      label: "false_positive",
      prKey,
    },
    outcome: "applied",
    ...overrides,
  };
}

function ledger(result: AppliedFindingFeedback) {
  const applyFindingFeedback = vi.fn().mockResolvedValue(result);
  const completeFeedbackReply = vi.fn().mockResolvedValue(undefined);
  const value: FeedbackLedger = {
    applyFindingFeedback,
    completeFeedbackReply,
    loadLatestReviewDecision: vi.fn().mockResolvedValue(decision),
  };
  return { applyFindingFeedback, completeFeedbackReply, value };
}

function publisher() {
  const replyToComment = vi.fn().mockResolvedValue(999);
  const updateCheckRun = vi.fn().mockResolvedValue(undefined);
  const value: ReviewPublisher = {
    findCommentByMarker: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn(),
    replyToComment,
    updateCheckRun,
  };
  return { replyToComment, updateCheckRun, value };
}

const commentInput = {
  authorAssociation: "COLLABORATOR",
  authorLogin: "alice",
  body: "/holon dismiss false-positive: handled by proxy",
  commentId: 202,
  createdAt: "2026-09-02T10:05:00.000Z",
  deliveryId: "github:delivery-1",
  inReplyToCommentId: 101,
  prKey,
  pullRequestNumber: 7,
} as const;

describe("feedback-service", () => {
  it("uses the persisted decision and Check Run ID when dismissal removes the blocker", async () => {
    const feedbackLedger = ledger(application());
    const reviewPublisher = publisher();

    const result = await processFeedbackComment(
      commentInput,
      feedbackLedger.value,
      reviewPublisher.value,
    );

    expect(result).toMatchObject({
      actionTaken: "dismissed",
      newVerdict: "APPROVE",
      replyPosted: true,
      verdictRecalculated: true,
    });
    expect(reviewPublisher.updateCheckRun).toHaveBeenCalledWith(
      expect.objectContaining({ checkRunId: 555, conclusion: "success" }),
    );
    expect(feedbackLedger.applyFindingFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: "github:delivery-1",
        targetCommentId: 101,
        update: { status: "dismissed" },
      }),
    );
  });

  it("preserves COMMENT for a partial review instead of fabricating complete scope", async () => {
    const feedbackLedger = ledger(
      application({
        decision: { ...decision, scopeStatus: "partial_by_failure" },
      }),
    );
    const reviewPublisher = publisher();

    const result = await processFeedbackComment(
      commentInput,
      feedbackLedger.value,
      reviewPublisher.value,
    );

    expect(result.newVerdict).toBe("COMMENT");
    expect(reviewPublisher.updateCheckRun).toHaveBeenCalledWith(
      expect.objectContaining({ conclusion: "neutral" }),
    );
  });

  it("uses persisted confidence when wrong-severity feedback changes policy", async () => {
    const medium = { ...finding, confidence: 0.8, severity: "medium" as const };
    const feedbackLedger = ledger(
      application({ activeFindings: [medium], feedback: undefined }),
    );
    const reviewPublisher = publisher();

    const result = await processFeedbackComment(
      {
        ...commentInput,
        body: "/holon dismiss wrong-severity:medium",
      },
      feedbackLedger.value,
      reviewPublisher.value,
    );

    expect(result.newVerdict).toBe("APPROVE");
    expect(feedbackLedger.applyFindingFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ update: { severity: "medium" } }),
    );
  });

  it("does not mutate the ledger for unauthorized verdict-changing feedback", async () => {
    const feedbackLedger = ledger(application());
    const reviewPublisher = publisher();

    const result = await processFeedbackComment(
      { ...commentInput, authorAssociation: "CONTRIBUTOR" },
      feedbackLedger.value,
      reviewPublisher.value,
    );

    expect(result).toEqual({ actionTaken: "unauthorized" });
    expect(feedbackLedger.applyFindingFeedback).not.toHaveBeenCalled();
    expect(reviewPublisher.updateCheckRun).not.toHaveBeenCalled();
  });

  it("does not duplicate a reply after an idempotent delivery resumes", async () => {
    const feedbackLedger = ledger(
      application({ outcome: "duplicate", replyCommentId: 999 }),
    );
    const reviewPublisher = publisher();

    const result = await processFeedbackComment(
      commentInput,
      feedbackLedger.value,
      reviewPublisher.value,
    );

    expect(result.replyPosted).toBe(false);
    expect(reviewPublisher.replyToComment).not.toHaveBeenCalled();
  });

  it("records helpful feedback and publishes one marker-backed reply", async () => {
    const feedbackLedger = ledger(
      application({
        activeFindings: [finding],
        feedback: { ...application().feedback!, label: "helpful" },
      }),
    );
    const reviewPublisher = publisher();

    const result = await processFeedbackComment(
      { ...commentInput, body: "/holon helpful" },
      feedbackLedger.value,
      reviewPublisher.value,
    );

    expect(result.actionTaken).toBe("recorded");
    expect(reviewPublisher.replyToComment).toHaveBeenCalledWith(
      202,
      expect.stringContaining("<!-- holon;feedback=github%3Adelivery-1 -->"),
    );
    expect(feedbackLedger.completeFeedbackReply).toHaveBeenCalledWith(
      "github:delivery-1",
      999,
    );
  });

  it("processes thread resolution only after boundary authorization", async () => {
    const feedbackLedger = ledger(application());
    const reviewPublisher = publisher();

    await expect(
      processThreadResolved(
        {
          authorLogin: "maintainer",
          authorized: false,
          deliveryId: "github:thread-1",
          prKey,
          pullRequestNumber: 7,
          rootCommentId: 101,
        },
        feedbackLedger.value,
        reviewPublisher.value,
      ),
    ).resolves.toEqual({ actionTaken: "ignored" });
    expect(feedbackLedger.applyFindingFeedback).not.toHaveBeenCalled();
  });
});
