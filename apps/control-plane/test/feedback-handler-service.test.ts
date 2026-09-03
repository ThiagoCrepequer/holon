import type { ReviewLedger, ReviewPublisher } from "@holon/application";
import type { FindingFingerprint, PrKey, RunId } from "@holon/domain";
import type {
  ReviewCommentWebhookEvent,
  ReviewThreadWebhookEvent,
} from "@holon/github";
import { describe, expect, it, vi } from "vitest";

import {
  handleFeedbackCommentWebhook,
  handleThreadResolvedWebhook,
} from "../src/feedback-handler-service.js";

const prKey: PrKey = "github:42:pr:7";
const runId: RunId =
  "github:42:pr:7:head:1111111111111111111111111111111111111111";
const fp1: FindingFingerprint =
  "fp:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("feedback-handler-service", () => {
  const fakeEnv = {
    AI_GATEWAY_ACCOUNT_ID: "acc",
    AI_GATEWAY_API_TOKEN: "tok",
    AI_GATEWAY_ID: "gw",
    AI_MODEL_ID: "model",
    GITHUB_APP_ID: "12345",
    GITHUB_APP_PRIVATE_KEY: "key",
    GITHUB_APP_SLUG: "holon",
    GITHUB_WEBHOOK_SECRET: "secret",
    REPOSITORY_EXECUTOR: {} as never,
    REVIEW_LEDGERS: {
      getByName: vi.fn(),
    } as never,
    REVIEW_QUEUE: {} as never,
    REVIEW_WORKFLOW: {} as never,
  };

  const sampleFinding = {
    diagnostic: "Buffer overflow vulnerability detected",
    filePath: "src/net.ts",
    fingerprint: fp1,
    firstSeenHeadSha: "1111111111111111111111111111111111111111",
    firstSeenRunId: runId,
    githubCommentId: 101,
    lastSeenHeadSha: "1111111111111111111111111111111111111111",
    lastSeenRunId: runId,
    line: 25,
    prKey,
    severity: "critical" as const,
    status: "new" as const,
    updatedAt: "2026-09-02T10:00:00.000Z",
  };

  it("handles comment webhook event and executes feedback dismissal", async () => {
    let storedFindings = [{ ...sampleFinding }];
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
      savePrFindings: vi.fn().mockImplementation((_prKey, f) => {
        storedFindings = [...f];
        return Promise.resolve();
      }),
      transition: vi.fn(),
    };

    const publisher: ReviewPublisher = {
      findCheckRunByExternalId: vi.fn().mockResolvedValue(444),
      findCommentByMarker: vi.fn(),
      publish: vi.fn(),
      replyToComment: vi.fn().mockResolvedValue(888),
      updateCheckRun: vi.fn().mockResolvedValue(undefined),
    };

    const event: ReviewCommentWebhookEvent = {
      action: "created",
      authorAssociation: "COLLABORATOR",
      authorLogin: "alice",
      body: "/holon dismiss false-positive: Handled by bound check",
      commentId: 202,
      createdAt: "2026-09-02T10:05:00.000Z",
      deliveryId: "github:del-123",
      inReplyToId: 101,
      installationId: 99,
      pullRequestNumber: 7,
      repository: {
        fullName: "acme/api",
        id: 42,
        name: "api",
        owner: "acme",
      },
    };

    const result = await handleFeedbackCommentWebhook(fakeEnv, event, {
      ledger,
      publisher,
    });

    expect(result.actionTaken).toBe("dismissed");
    expect(result.verdictRecalculated).toBe(true);
    expect(result.newVerdict).toBe("APPROVE");
    expect(storedFindings[0]?.status).toBe("dismissed");
  });

  it("handles thread resolved webhook event and executes thread dismissal", async () => {
    let storedFindings = [{ ...sampleFinding }];
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
      savePrFindings: vi.fn().mockImplementation((_prKey, f) => {
        storedFindings = [...f];
        return Promise.resolve();
      }),
      transition: vi.fn(),
    };

    const publisher: ReviewPublisher = {
      findCheckRunByExternalId: vi.fn().mockResolvedValue(444),
      findCommentByMarker: vi.fn(),
      publish: vi.fn(),
      updateCheckRun: vi.fn().mockResolvedValue(undefined),
    };

    const event: ReviewThreadWebhookEvent = {
      action: "resolved",
      authorAssociation: "MEMBER",
      authorLogin: "bob",
      deliveryId: "github:del-456",
      installationId: 99,
      pullRequestNumber: 7,
      repository: {
        fullName: "acme/api",
        id: 42,
        name: "api",
        owner: "acme",
      },
      rootCommentId: 101,
    };

    const result = await handleThreadResolvedWebhook(fakeEnv, event, {
      ledger,
      publisher,
    });

    expect(result.actionTaken).toBe("dismissed");
    expect(storedFindings[0]?.status).toBe("dismissed");
  });

  it("handles session creation failure gracefully", async () => {
    const event: ReviewCommentWebhookEvent = {
      action: "created",
      authorLogin: "alice",
      body: "/holon dismiss false-positive",
      commentId: 202,
      createdAt: "2026-09-02T10:05:00.000Z",
      deliveryId: "github:del-123",
      inReplyToId: 101,
      installationId: 99,
      pullRequestNumber: 7,
      repository: {
        fullName: "acme/api",
        id: 42,
        name: "api",
        owner: "acme",
      },
    };

    const result = await handleFeedbackCommentWebhook(fakeEnv, event, {
      createSession: vi.fn().mockRejectedValue(new Error("Session error")),
      ledger: {} as never,
    });

    expect(result.actionTaken).toBe("ignored");
  });

  it("creates session and publisher through factories when publisher is omitted", async () => {
    let storedFindings = [{ ...sampleFinding }];
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
      savePrFindings: vi.fn().mockImplementation((_prKey, f) => {
        storedFindings = [...f];
        return Promise.resolve();
      }),
      transition: vi.fn(),
    };

    const mockSession = {
      api: {
        request: vi.fn().mockResolvedValue({ data: { id: 999 } }),
        rest: {
          checks: {
            listForRef: vi.fn().mockResolvedValue({ data: { check_runs: [] } }),
            update: vi.fn().mockResolvedValue({ data: {} }),
          },
          pulls: {
            createReplyForReviewComment: vi
              .fn()
              .mockResolvedValue({ data: { id: 999 } }),
            listReviewComments: vi.fn().mockResolvedValue({ data: [] }),
          },
        },
      } as never,
      expectedAuthorLogin: "holon-reviewer[bot]",
    };

    const event: ReviewCommentWebhookEvent = {
      action: "created",
      authorAssociation: "COLLABORATOR",
      authorLogin: "alice",
      body: "/holon dismiss false-positive",
      commentId: 202,
      createdAt: "2026-09-02T10:05:00.000Z",
      deliveryId: "github:del-123",
      inReplyToId: 101,
      installationId: 99,
      pullRequestNumber: 7,
      repository: {
        fullName: "acme/api",
        id: 42,
        name: "api",
        owner: "acme",
      },
    };

    const result = await handleFeedbackCommentWebhook(fakeEnv, event, {
      createSession: vi.fn().mockResolvedValue(mockSession),
      ledger,
    });

    expect(result.actionTaken).toBe("dismissed");

    // Also for thread resolved
    const threadEvent: ReviewThreadWebhookEvent = {
      action: "resolved",
      authorAssociation: "MEMBER",
      authorLogin: "bob",
      deliveryId: "github:del-456",
      installationId: 99,
      pullRequestNumber: 7,
      repository: {
        fullName: "acme/api",
        id: 42,
        name: "api",
        owner: "acme",
      },
      rootCommentId: 101,
    };

    const threadResult = await handleThreadResolvedWebhook(
      fakeEnv,
      threadEvent,
      {
        createSession: vi.fn().mockResolvedValue(mockSession),
        ledger,
      },
    );

    expect(threadResult.actionTaken).toBe("dismissed");
  });

  it("handles thread session failure and ledger unavailable", async () => {
    const threadEvent: ReviewThreadWebhookEvent = {
      action: "resolved",
      authorLogin: "bob",
      deliveryId: "github:del-456",
      installationId: 99,
      pullRequestNumber: 7,
      repository: {
        fullName: "acme/api",
        id: 42,
        name: "api",
        owner: "acme",
      },
      rootCommentId: 101,
    };

    const threadSessionFail = await handleThreadResolvedWebhook(
      fakeEnv,
      threadEvent,
      {
        createSession: vi.fn().mockRejectedValue(new Error("Fail")),
        ledger: {} as never,
      },
    );
    expect(threadSessionFail.actionTaken).toBe("ignored");

    const envWithoutLedgers = {
      ...fakeEnv,
      REVIEW_LEDGERS: undefined as never,
    };

    const ledgerFail1 = await handleFeedbackCommentWebhook(
      envWithoutLedgers,
      {
        action: "created",
        authorLogin: "alice",
        body: "/holon dismiss false-positive",
        commentId: 202,
        createdAt: "2026-09-02T10:05:00.000Z",
        deliveryId: "github:del-123",
        inReplyToId: 101,
        installationId: 99,
        pullRequestNumber: 7,
        repository: {
          fullName: "acme/api",
          id: 42,
          name: "api",
          owner: "acme",
        },
      },
      {},
    );
    expect(ledgerFail1.actionTaken).toBe("ignored");

    const ledgerFail2 = await handleThreadResolvedWebhook(
      envWithoutLedgers,
      threadEvent,
      {},
    );
    expect(ledgerFail2.actionTaken).toBe("ignored");
  });
});
