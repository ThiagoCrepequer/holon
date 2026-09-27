import type {
  AppliedFindingFeedback,
  FeedbackLedger,
  ReviewDecisionContext,
  ReviewPublisher,
} from "@holon/application";
import type {
  GitHubInstallationSession,
  ReviewCommentWebhookEvent,
  ReviewThreadWebhookEvent,
} from "@holon/github";
import { describe, expect, it, vi } from "vitest";

import {
  handleFeedbackCommentWebhook,
  handleThreadResolvedWebhook,
} from "../src/feedback-handler-service.js";
import { configurationReader } from "./configuration-fixtures.js";

const decision: ReviewDecisionContext = {
  verdictPolicy: { mediumSeverityThreshold: 2 },
  output: { language: "en", detail: "concise", maxInlineComments: 40 },
  checkRunId: 55,
  headSha: "a".repeat(40),
  isDegraded: false,
  runId: `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}`,
  scopeStatus: "complete",
  shardsAnalyzed: 1,
  totalShards: 1,
};

const applied: AppliedFindingFeedback = {
  activeFindings: [],
  decision,
  feedback: {
    authorLogin: "alice",
    createdAt: "2026-09-02T10:05:00.000Z",
    fingerprint:
      "fp:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    githubCommentId: 202,
    label: "false_positive",
    prKey: "github:42:pr:7",
  },
  outcome: "applied",
};

function ledger() {
  const applyFindingFeedback = vi.fn().mockResolvedValue(applied);
  const value: FeedbackLedger = {
    applyFindingFeedback,
    completeFeedbackReply: vi.fn().mockResolvedValue(undefined),
    loadLatestReviewDecision: vi.fn().mockResolvedValue(decision),
  };
  return { applyFindingFeedback, value };
}

function publisher(): ReviewPublisher {
  return {
    findCommentByMarker: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn(),
    replyToComment: vi.fn().mockResolvedValue(999),
    updateCheckRun: vi.fn().mockResolvedValue(undefined),
  };
}

function session(permission = "write") {
  const repositoryPermission = vi.fn().mockResolvedValue(permission);
  const value: GitHubInstallationSession = {
    api: {} as never,
    configurationReader: () => configurationReader(),
    currentHeadSha: vi.fn(),
    currentPullRequestRefs: vi.fn(),
    expectedAuthorLogin: "holon-reviewer[bot]",
    expiresAt: "2026-09-02T11:00:00.000Z",
    pullRequestDiff: vi.fn(),
    repositoryPermission,
    token: "installation-token-long-enough",
  };
  return { repositoryPermission, value };
}

const commentEvent: ReviewCommentWebhookEvent = {
  action: "created",
  authorAssociation: "COLLABORATOR",
  authorLogin: "alice",
  body: "/holon dismiss false-positive",
  commentId: 202,
  createdAt: "2026-09-02T10:05:00.000Z",
  deliveryId: "github:delivery-1",
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

const threadEvent: ReviewThreadWebhookEvent = {
  action: "resolved",
  authorLogin: "bob",
  deliveryId: "github:thread-1",
  installationId: 99,
  pullRequestNumber: 7,
  repository: commentEvent.repository,
  rootCommentId: 101,
};

const fakeEnv = {
  GITHUB_APP_ID: "123",
  GITHUB_APP_PRIVATE_KEY_CURRENT: "private-key",
  GITHUB_APP_SLUG: "holon-reviewer",
} as Cloudflare.Env;

describe("feedback-handler-service", () => {
  it("ignores feedback when the latest run has no canonical decision", async () => {
    const createSession = vi.fn();
    const currentLedger = ledger();
    currentLedger.value.loadLatestReviewDecision = vi
      .fn()
      .mockResolvedValue(undefined);

    await expect(
      handleFeedbackCommentWebhook(fakeEnv, commentEvent, {
        createSession,
        ledger: currentLedger.value,
      }),
    ).resolves.toEqual({ actionTaken: "ignored" });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("passes the persisted head SHA to the publisher", async () => {
    const createPublisher = vi.fn((_api, _target) => publisher());

    const result = await handleFeedbackCommentWebhook(fakeEnv, commentEvent, {
      createPublisher,
      createSession: vi.fn().mockResolvedValue(session().value),
      ledger: ledger().value,
    });

    expect(result.actionTaken).toBe("dismissed");
    expect(createPublisher).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ headSha: "a".repeat(40) }),
    );
  });

  it("authorizes thread resolution from the repository permission API", async () => {
    const currentSession = session("maintain");
    const currentLedger = ledger();

    const result = await handleThreadResolvedWebhook(fakeEnv, threadEvent, {
      createSession: vi.fn().mockResolvedValue(currentSession.value),
      ledger: currentLedger.value,
      publisher: publisher(),
    });

    expect(result.actionTaken).toBe("dismissed");
    expect(currentSession.repositoryPermission).toHaveBeenCalledWith(
      "acme",
      "api",
      "bob",
    );
    expect(currentLedger.applyFindingFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: "github:thread-1" }),
    );
  });

  it("rejects thread resolution without write-level repository permission", async () => {
    const currentLedger = ledger();

    const result = await handleThreadResolvedWebhook(fakeEnv, threadEvent, {
      createSession: vi.fn().mockResolvedValue(session("read").value),
      ledger: currentLedger.value,
      publisher: publisher(),
    });

    expect(result.actionTaken).toBe("ignored");
    expect(currentLedger.applyFindingFeedback).not.toHaveBeenCalled();
  });

  it("fails closed when the installation session cannot read permissions", async () => {
    const logger = { emit: vi.fn() };
    const currentSession = session();
    const sessionWithoutPermission = {
      ...currentSession.value,
      repositoryPermission: undefined,
    };

    await expect(
      handleThreadResolvedWebhook(fakeEnv, threadEvent, {
        createSession: vi.fn().mockResolvedValue(sessionWithoutPermission),
        ledger: ledger().value,
        logger,
        publisher: publisher(),
      }),
    ).rejects.toThrow("permission lookup");
    expect(logger.emit).toHaveBeenCalledWith(
      "feedback_handler_session_failed",
      expect.objectContaining({ errorKind: "TypeError" }),
    );
  });

  it("logs only the error kind when session creation fails", async () => {
    const logger = { emit: vi.fn() };

    await expect(
      handleFeedbackCommentWebhook(fakeEnv, commentEvent, {
        createSession: vi.fn().mockRejectedValue(new Error("secret detail")),
        ledger: ledger().value,
        logger,
      }),
    ).rejects.toThrow("secret detail");
    expect(logger.emit).toHaveBeenCalledWith(
      "feedback_handler_session_failed",
      expect.objectContaining({ errorKind: "Error" }),
    );
    expect(JSON.stringify(logger.emit.mock.calls)).not.toContain(
      "secret detail",
    );
  });
});
