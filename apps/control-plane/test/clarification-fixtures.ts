import type { ClarificationAdmission } from "@holon/contracts";
import type { TrackedFinding } from "@holon/domain";
import type { GitHubInstallationSession } from "@holon/github";
import { env } from "cloudflare:workers";
import { vi } from "vitest";

import {
  defaultRunConfiguration,
  configurationReader,
} from "./configuration-fixtures.js";
export const prKey = "github:42:pr:7" as const;
export const runId =
  `${prKey}:head:${"a".repeat(40)}:base:${"b".repeat(40)}` as const;
export const admission: ClarificationAdmission = {
  event: {
    action: "created",
    authorAssociation: "OWNER",
    authorLogin: "alice",
    body: "@holon Esta validação já evita o problema?",
    commentId: 202,
    inReplyToId: 101,
    createdAt: "2026-10-04T12:00:00Z",
    deliveryId: "github:question-1",
    installationId: 99,
    pullRequestNumber: 7,
    repository: { fullName: "acme/api", owner: "acme", name: "api", id: 42 },
  },
  question: "Esta validação já evita o problema?",
  headSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  additionalExcludes: [],
};
export const finding: TrackedFinding = {
  prKey,
  fingerprint: `fp:${"c".repeat(64)}`,
  evidenceFingerprint: "d".repeat(64),
  diagnostic:
    "A entrada vazia chega à execução sem validação e causa uma falha.",
  filePath: "src/input.ts",
  line: 3,
  confidence: 0.95,
  severity: "high",
  status: "new",
  githubCommentId: 101,
  firstSeenRunId: runId,
  lastSeenRunId: runId,
  firstSeenHeadSha: admission.headSha,
  lastSeenHeadSha: admission.headSha,
  updatedAt: admission.event.createdAt,
};
export async function clarificationLedger() {
  const ledger = env.REVIEW_LEDGERS.getByName(prKey);
  const now = new Date().toISOString();
  await ledger.claimRun(
    {
      id: runId,
      prKey,
      causalVersion: now,
      createdAt: now,
      state: "queued",
      attempt: 0,
    },
    "clarification-fixture",
  );
  await ledger.transition(runId, "queued", "running", now, "start");
  await ledger.saveRunConfiguration(
    await defaultRunConfiguration({
      runId,
      envelope: {
        action: "opened",
        event: "pull_request",
        installationId: 99,
        repository: admission.event.repository,
        deliveryId: "github:config",
        receivedAt: admission.event.createdAt,
        pullRequest: {
          number: 7,
          baseSha: admission.baseSha,
          headSha: admission.headSha,
          title: "Synthetic pull request",
          author: "synthetic",
          state: "open",
          updatedAt: admission.event.createdAt,
        },
      },
    }),
  );
  await ledger.transition(runId, "running", "publishing", now, "publish");
  await ledger.savePrFindings(prKey, [finding], runId);
  await ledger.recordReviewDecision(runId, {
    headSha: admission.headSha,
    output: { language: "pt-BR", detail: "concise", maxInlineComments: 40 },
    verdictPolicy: { mediumSeverityThreshold: 2 },
    isDegraded: false,
    scopeStatus: "complete",
    shardsAnalyzed: 1,
    totalShards: 1,
  });
  await ledger.transition(runId, "publishing", "completed", now, "complete");
  return ledger;
}

export function questionSession(): GitHubInstallationSession {
  return {
    api: {
      request: vi.fn().mockResolvedValue({ data: { id: 303 } }),
      iterate: async function* () {
        yield [];
      },
    },
    discussionReader: () => ({
      comment: async (id) => ({
        id,
        body: id === 202 ? admission.event.body : finding.diagnostic,
        path: finding.filePath,
        commit_id: admission.headSha,
        ...(id === 202 ? { in_reply_to_id: 101 } : {}),
        pull_request_url: "https://api.github.com/repos/acme/api/pulls/7",
        user:
          id === 202
            ? { login: "alice", type: "User" }
            : { login: "holon-reviewer[bot]", type: "Bot" },
      }),
      pullRequest: async () => ({
        number: 7,
        state: "open",
        user: { login: "alice", type: "User" },
        head: { sha: admission.headSha },
        base: { sha: admission.baseSha },
      }),
    }),
    configurationReader: () => configurationReader(),
    currentHeadSha: async () => admission.headSha,
    currentPullRequestRefs: async () => ({
      headSha: admission.headSha,
      baseSha: admission.baseSha,
    }),
    expectedAuthorLogin: "holon-reviewer[bot]",
    expiresAt: "2026-10-04T19:00:00Z",
    token: "synthetic-installation-token",
    pullRequestDiff: async () => "",
    repositoryPermission: async () => "write",
  };
}
