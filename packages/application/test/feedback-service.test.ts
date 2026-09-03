import type { TrackedFinding } from "@holon/contracts";
import type { FindingFingerprint, PrKey, RunId } from "@holon/domain";
import { describe, expect, it, vi } from "vitest";

import {
  processFeedbackComment,
  processThreadResolved,
} from "../src/feedback-service.js";
import type { ReviewLedger, ReviewPublisher } from "../src/ports.js";

const prKey: PrKey = "github:42:pr:7";
const runId: RunId =
  "github:42:pr:7:head:1111111111111111111111111111111111111111";
const fp1: FindingFingerprint =
  "fp:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("feedback-service", () => {
  const sampleFinding: TrackedFinding = {
    diagnostic: "Critical vulnerability in authentication layer",
    filePath: "src/auth.ts",
    fingerprint: fp1,
    firstSeenHeadSha: "1111111111111111111111111111111111111111",
    firstSeenRunId: runId,
    githubCommentId: 101,
    lastSeenHeadSha: "1111111111111111111111111111111111111111",
    lastSeenRunId: runId,
    line: 42,
    prKey,
    severity: "critical",
    status: "new",
    updatedAt: "2026-09-02T10:00:00.000Z",
  };

  it("dismisses a finding as false positive, recalculates verdict to APPROVE and updates Check Run", async () => {
    let storedFindings: TrackedFinding[] = [sampleFinding];
    const recordedFeedbacks: unknown[] = [];
    const checkRunUpdates: unknown[] = [];
    const commentReplies: Array<{ commentId: number; body: string }> = [];

    const ledger: ReviewLedger = {
      claimRun: vi.fn(),
      claimPublication: vi.fn(),
      completePublication: vi.fn(),
      findFindingByCommentId: vi
        .fn()
        .mockImplementation((_prKey, commentId) => {
          return Promise.resolve(
            storedFindings.find((f) => f.githubCommentId === commentId),
          );
        }),
      isLatestRun: vi.fn().mockResolvedValue(true),
      loadFindingFeedbacks: vi.fn().mockResolvedValue([]),
      loadPrFindings: vi.fn().mockImplementation(() => {
        return Promise.resolve([...storedFindings]);
      }),
      recordFindingFeedback: vi.fn().mockImplementation((_prKey, fb) => {
        recordedFeedbacks.push(fb);
        return Promise.resolve();
      }),
      savePrFindings: vi.fn().mockImplementation((_prKey, findings) => {
        storedFindings = [...findings];
        return Promise.resolve();
      }),
      transition: vi.fn(),
    };

    const publisher: ReviewPublisher = {
      findCheckRunByExternalId: vi.fn().mockResolvedValue(555),
      findCommentByMarker: vi.fn(),
      publish: vi.fn(),
      replyToComment: vi.fn().mockImplementation((commentId, body) => {
        commentReplies.push({ body, commentId });
        return Promise.resolve(999);
      }),
      updateCheckRun: vi.fn().mockImplementation((input) => {
        checkRunUpdates.push(input);
        return Promise.resolve();
      }),
    };

    const result = await processFeedbackComment(
      {
        authorAssociation: "COLLABORATOR",
        authorLogin: "alice",
        body: "/holon dismiss false-positive: Auth is handled by proxy",
        commentId: 202,
        inReplyToCommentId: 101,
        prKey,
        pullRequestNumber: 7,
      },
      ledger,
      publisher,
    );

    expect(result.actionTaken).toBe("dismissed");
    expect(result.verdictRecalculated).toBe(true);
    expect(result.newVerdict).toBe("APPROVE");
    expect(result.replyPosted).toBe(true);

    // Ledger must have saved finding with 'dismissed' status
    expect(storedFindings[0]?.status).toBe("dismissed");

    // Feedback record was persisted
    expect(recordedFeedbacks).toHaveLength(1);
    expect(recordedFeedbacks[0]).toMatchObject({
      authorLogin: "alice",
      fingerprint: fp1,
      label: "false_positive",
      reason: "Auth is handled by proxy",
    });

    // Check Run was updated to success (Approved)
    expect(checkRunUpdates).toHaveLength(1);
    expect(checkRunUpdates[0]).toMatchObject({
      checkRunId: 555,
      conclusion: "success",
      output: {
        title: "Holon Review — Approved",
      },
    });

    // Reply was posted to developer
    expect(commentReplies).toHaveLength(1);
    expect(commentReplies[0]?.body).toContain("👀 Defeito dispensado");
    expect(commentReplies[0]?.body).toContain("APPROVE");
  });

  it("records helpful feedback without modifying finding status", async () => {
    let storedFindings: TrackedFinding[] = [sampleFinding];
    const recordedFeedbacks: unknown[] = [];
    const commentReplies: Array<{ commentId: number; body: string }> = [];

    const ledger: ReviewLedger = {
      claimRun: vi.fn(),
      claimPublication: vi.fn(),
      completePublication: vi.fn(),
      findFindingByCommentId: vi.fn().mockResolvedValue(sampleFinding),
      isLatestRun: vi.fn().mockResolvedValue(true),
      loadFindingFeedbacks: vi.fn().mockResolvedValue([]),
      loadPrFindings: vi.fn().mockResolvedValue(storedFindings),
      recordFindingFeedback: vi.fn().mockImplementation((_prKey, fb) => {
        recordedFeedbacks.push(fb);
        return Promise.resolve();
      }),
      savePrFindings: vi.fn().mockImplementation((_prKey, f) => {
        storedFindings = f;
        return Promise.resolve();
      }),
      transition: vi.fn(),
    };

    const publisher: ReviewPublisher = {
      findCommentByMarker: vi.fn(),
      publish: vi.fn(),
      replyToComment: vi.fn().mockImplementation((commentId, body) => {
        commentReplies.push({ body, commentId });
        return Promise.resolve(999);
      }),
    };

    const result = await processFeedbackComment(
      {
        authorLogin: "bob",
        body: "/holon helpful: Great suggestion!",
        commentId: 203,
        inReplyToCommentId: 101,
        prKey,
        pullRequestNumber: 7,
      },
      ledger,
      publisher,
    );

    expect(result.actionTaken).toBe("recorded");
    expect(result.replyPosted).toBe(true);
    expect(sampleFinding.status).toBe("new");
    expect(recordedFeedbacks).toHaveLength(1);
    expect(recordedFeedbacks[0]).toMatchObject({
      label: "helpful",
      reason: "Great suggestion!",
    });
    expect(commentReplies[0]?.body).toContain("Obrigado pelo feedback");
  });

  it("ignores comments that do not contain holon commands or emojis", async () => {
    const ledger: ReviewLedger = {
      claimRun: vi.fn(),
      claimPublication: vi.fn(),
      completePublication: vi.fn(),
      isLatestRun: vi.fn().mockResolvedValue(true),
      transition: vi.fn(),
    };
    const publisher: ReviewPublisher = {
      findCommentByMarker: vi.fn(),
      publish: vi.fn(),
    };

    const result = await processFeedbackComment(
      {
        authorLogin: "carol",
        body: "I will look into this later.",
        commentId: 204,
        inReplyToCommentId: 101,
        prKey,
        pullRequestNumber: 7,
      },
      ledger,
      publisher,
    );

    expect(result.actionTaken).toBe("ignored");
  });

  it("handles processThreadResolved for native GitHub thread resolution", async () => {
    let storedFindings: TrackedFinding[] = [{ ...sampleFinding }];
    const recordedFeedbacks: unknown[] = [];

    const ledger: ReviewLedger = {
      claimRun: vi.fn(),
      claimPublication: vi.fn(),
      completePublication: vi.fn(),
      findFindingByCommentId: vi.fn().mockResolvedValue(storedFindings[0]),
      isLatestRun: vi.fn().mockResolvedValue(true),
      loadPrFindings: vi
        .fn()
        .mockImplementation(() => Promise.resolve([...storedFindings])),
      recordFindingFeedback: vi.fn().mockImplementation((_prKey, fb) => {
        recordedFeedbacks.push(fb);
        return Promise.resolve();
      }),
      savePrFindings: vi.fn().mockImplementation((_prKey, findings) => {
        storedFindings = [...findings];
        return Promise.resolve();
      }),
      transition: vi.fn(),
    };

    const publisher: ReviewPublisher = {
      findCommentByMarker: vi.fn(),
      publish: vi.fn(),
    };

    const result = await processThreadResolved(
      {
        authorAssociation: "MEMBER",
        authorLogin: "dave",
        prKey,
        pullRequestNumber: 7,
        rootCommentId: 101,
      },
      ledger,
      publisher,
    );

    expect(result.actionTaken).toBe("dismissed");
    expect(storedFindings[0]?.status).toBe("dismissed");
    expect(recordedFeedbacks[0]).toMatchObject({
      label: "thread_resolved",
    });
  });

  it("handles processThreadResolved updating Check Run to failure if other blockers remain", async () => {
    const secondFinding: TrackedFinding = {
      diagnostic: "Second critical issue in code",
      filePath: "src/security.ts",
      fingerprint:
        "fp:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      firstSeenHeadSha: "1111111111111111111111111111111111111111",
      firstSeenRunId: runId,
      githubCommentId: 102,
      lastSeenHeadSha: "1111111111111111111111111111111111111111",
      lastSeenRunId: runId,
      line: 10,
      prKey,
      severity: "critical",
      status: "new",
      updatedAt: "2026-09-02T10:00:00.000Z",
    };

    let storedFindings: TrackedFinding[] = [
      { ...sampleFinding },
      secondFinding,
    ];
    const checkRunUpdates: unknown[] = [];

    const ledger: ReviewLedger = {
      claimRun: vi.fn(),
      claimPublication: vi.fn(),
      completePublication: vi.fn(),
      findFindingByCommentId: vi.fn().mockResolvedValue(storedFindings[0]),
      isLatestRun: vi.fn().mockResolvedValue(true),
      loadPrFindings: vi
        .fn()
        .mockImplementation(() => Promise.resolve([...storedFindings])),
      recordFindingFeedback: vi.fn().mockResolvedValue(undefined),
      savePrFindings: vi.fn().mockImplementation((_prKey, findings) => {
        storedFindings = [...findings];
        return Promise.resolve();
      }),
      transition: vi.fn(),
    };

    const publisher: ReviewPublisher = {
      findCheckRunByExternalId: vi.fn().mockResolvedValue(777),
      findCommentByMarker: vi.fn(),
      publish: vi.fn(),
      updateCheckRun: vi.fn().mockImplementation((input) => {
        checkRunUpdates.push(input);
        return Promise.resolve();
      }),
    };

    const result = await processThreadResolved(
      {
        authorAssociation: "OWNER",
        authorLogin: "dave",
        prKey,
        pullRequestNumber: 7,
        rootCommentId: 101,
      },
      ledger,
      publisher,
    );

    expect(result.actionTaken).toBe("dismissed");
    expect(result.newVerdict).toBe("REQUEST_CHANGES");
    expect(checkRunUpdates).toHaveLength(1);
    expect(checkRunUpdates[0]).toMatchObject({
      checkRunId: 777,
      conclusion: "failure",
    });
  });

  it("ignores processThreadResolved when finding does not exist or is already resolved", async () => {
    const ledger: ReviewLedger = {
      claimRun: vi.fn(),
      claimPublication: vi.fn(),
      completePublication: vi.fn(),
      findFindingByCommentId: vi.fn().mockResolvedValue({
        ...sampleFinding,
        status: "resolved",
      }),
      isLatestRun: vi.fn().mockResolvedValue(true),
      transition: vi.fn(),
    };
    const publisher: ReviewPublisher = {
      findCommentByMarker: vi.fn(),
      publish: vi.fn(),
    };

    const result = await processThreadResolved(
      {
        authorLogin: "dave",
        prKey,
        pullRequestNumber: 7,
        rootCommentId: 101,
      },
      ledger,
      publisher,
    );

    expect(result.actionTaken).toBe("ignored");
  });

  it("handles missed-defect or non-dismissal feedback recording", async () => {
    const recordedFeedbacks: unknown[] = [];
    const ledger: ReviewLedger = {
      claimRun: vi.fn(),
      claimPublication: vi.fn(),
      completePublication: vi.fn(),
      findFindingByCommentId: vi.fn().mockResolvedValue(sampleFinding),
      isLatestRun: vi.fn().mockResolvedValue(true),
      recordFindingFeedback: vi.fn().mockImplementation((_prKey, fb) => {
        recordedFeedbacks.push(fb);
        return Promise.resolve();
      }),
      transition: vi.fn(),
    };
    const publisher: ReviewPublisher = {
      findCommentByMarker: vi.fn(),
      publish: vi.fn(),
    };

    const result = await processFeedbackComment(
      {
        authorLogin: "eve",
        body: "/holon missed-defect src/other.ts:10 Missing check",
        commentId: 300,
        inReplyToCommentId: 101,
        prKey,
        pullRequestNumber: 7,
      },
      ledger,
      publisher,
    );

    expect(result.actionTaken).toBe("recorded");
    expect(recordedFeedbacks).toHaveLength(1);
  });

  it("ignores feedback when finding is not found for targetCommentId", async () => {
    const ledger: ReviewLedger = {
      claimRun: vi.fn(),
      claimPublication: vi.fn(),
      completePublication: vi.fn(),
      findFindingByCommentId: vi.fn().mockResolvedValue(undefined),
      isLatestRun: vi.fn().mockResolvedValue(true),
      transition: vi.fn(),
    };
    const publisher: ReviewPublisher = {
      findCommentByMarker: vi.fn(),
      publish: vi.fn(),
    };

    const result = await processFeedbackComment(
      {
        authorLogin: "eve",
        body: "/holon dismiss false-positive",
        commentId: 300,
        inReplyToCommentId: 9999,
        prKey,
        pullRequestNumber: 7,
      },
      ledger,
      publisher,
    );

    expect(result.actionTaken).toBe("ignored");
  });

  it("rejects dismissal from unauthorized commenter without changing status or verdict", async () => {
    let storedFindings = [{ ...sampleFinding }];
    const commentReplies: { body: string; commentId: number }[] = [];
    const checkRunUpdates: unknown[] = [];

    const ledger: ReviewLedger = {
      claimPublication: vi.fn(),
      claimRun: vi.fn(),
      completePublication: vi.fn(),
      findFindingByCommentId: vi.fn().mockImplementation((_pk, id) => {
        return Promise.resolve(
          storedFindings.find((f) => f.githubCommentId === id),
        );
      }),
      isLatestRun: vi.fn().mockResolvedValue(true),
      loadFindingFeedbacks: vi.fn().mockResolvedValue([]),
      loadPrFindings: vi
        .fn()
        .mockImplementation(() => Promise.resolve([...storedFindings])),
      recordFindingFeedback: vi.fn().mockResolvedValue(undefined),
      savePrFindings: vi.fn().mockImplementation((_prKey, findings) => {
        storedFindings = [...findings];
        return Promise.resolve();
      }),
      transition: vi.fn(),
    };

    const publisher: ReviewPublisher = {
      findCheckRunByExternalId: vi.fn().mockResolvedValue(555),
      findCommentByMarker: vi.fn(),
      publish: vi.fn(),
      replyToComment: vi.fn().mockImplementation((commentId, body) => {
        commentReplies.push({ body, commentId });
        return Promise.resolve(999);
      }),
      updateCheckRun: vi.fn().mockImplementation((input) => {
        checkRunUpdates.push(input);
        return Promise.resolve();
      }),
    };

    const result = await processFeedbackComment(
      {
        authorAssociation: "NONE",
        authorLogin: "untrusted_contributor",
        body: "/holon dismiss false-positive: Not a bug",
        commentId: 202,
        inReplyToCommentId: 101,
        prKey,
        pullRequestNumber: 7,
      },
      ledger,
      publisher,
    );

    expect(result.actionTaken).toBe("unauthorized");
    expect(result.verdictRecalculated).toBeUndefined();
    expect(result.replyPosted).toBe(true);

    // Finding must NOT be dismissed!
    expect(storedFindings[0]?.status).toBe("new");
    // Check Run must NOT be updated!
    expect(checkRunUpdates).toHaveLength(0);
    // Reply warning posted
    expect(commentReplies[0]?.body).toContain(
      "Apenas mantenedores do repositório",
    );
  });

  it("ignores thread resolution from unauthorized commenter", async () => {
    const storedFindings = [{ ...sampleFinding }];
    const ledger: ReviewLedger = {
      claimPublication: vi.fn(),
      claimRun: vi.fn(),
      completePublication: vi.fn(),
      findFindingByCommentId: vi.fn().mockResolvedValue(storedFindings[0]),
      isLatestRun: vi.fn().mockResolvedValue(true),
      loadPrFindings: vi
        .fn()
        .mockImplementation(() => Promise.resolve([...storedFindings])),
      recordFindingFeedback: vi.fn().mockResolvedValue(undefined),
      savePrFindings: vi.fn().mockImplementation((_prKey, _findings) => {
        return Promise.resolve();
      }),
      transition: vi.fn(),
    };

    const publisher: ReviewPublisher = {
      findCommentByMarker: vi.fn(),
      publish: vi.fn(),
    };

    const result = await processThreadResolved(
      {
        authorAssociation: "CONTRIBUTOR",
        authorLogin: "external_author",
        prKey,
        pullRequestNumber: 7,
        rootCommentId: 101,
      },
      ledger,
      publisher,
    );

    expect(result.actionTaken).toBe("ignored");
    expect(storedFindings[0]?.status).toBe("new");
  });
});
