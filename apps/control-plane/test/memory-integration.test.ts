import type { ReconciledReviewOutput } from "@holon/contracts";
import { reviewJobSchema } from "@holon/contracts";
import type { ReviewCommentWebhookEvent } from "@holon/github";
import { reset, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";

import { handleFeedbackCommentWebhook } from "../src/ingress/feedback-handler-service.js";
import { handleMemoryComment } from "../src/memory/memory-comment.js";
import { resolveRunMemory } from "../src/memory/run-memory.js";

const headSha = "a".repeat(40),
  baseSha = "b".repeat(40);
const runId = `github:42:pr:7:head:${headSha}:base:${baseSha}` as const;
const prKey = "github:42:pr:7" as const;
const fingerprint = `fp:${"c".repeat(64)}` as const;
const identity = { installationId: 99, repositoryId: 42 };
const finding = {
  confidence: 0.95,
  diagnostic: "Removing the gateway guard allows an unauthorized operation.",
  severity: "high" as const,
  location: { path: "src/index.ts", line: 10, side: "RIGHT" as const },
  evidence: [
    {
      path: "src/index.ts",
      startLine: 10,
      excerpt: "return null;",
      reason: "Guard removed",
    },
  ],
};
const tracked = {
  confidence: 0.95,
  diagnostic: finding.diagnostic,
  filePath: finding.location.path,
  fingerprint,
  evidenceFingerprint: "d".repeat(64),
  firstSeenHeadSha: headSha,
  firstSeenRunId: runId,
  lastSeenHeadSha: headSha,
  lastSeenRunId: runId,
  githubCommentId: 101,
  line: 10,
  prKey,
  severity: "high" as const,
  status: "new" as const,
  updatedAt: new Date().toISOString(),
};
const output: ReconciledReviewOutput = {
  output: { language: "en", detail: "concise", maxInlineComments: 40 },
  activeFindings: [
    {
      ...finding,
      fingerprint,
      evidenceFingerprint: "d".repeat(64),
      status: "new",
    },
  ],
  findings: [finding],
  investigations: [
    {
      path: "src/index.ts",
      line: 10,
      excerpt: "return null;",
      summary:
        "This changed branch exits before the gateway authorization check.",
    },
  ],
  resolvedFindings: [],
  updatedTrackedFindings: [tracked],
  omissionReasons: [],
  scopeStatus: "complete",
  shardsAnalyzed: 1,
  totalShards: 1,
  summary: "Review complete.",
};
async function setup() {
  const ledger = env.REVIEW_LEDGERS.getByName(prKey);
  const now = new Date().toISOString();
  await ledger.claimRun(
    {
      id: runId,
      prKey,
      state: "queued",
      attempt: 0,
      causalVersion: now,
      createdAt: now,
    },
    "memory-integration",
  );
  await ledger.transition(runId, "queued", "running", now, "start");
  const job = reviewJobSchema.parse({
    runId,
    envelope: {
      event: "pull_request",
      action: "opened",
      deliveryId: "github:test",
      installationId: 99,
      receivedAt: now,
      repository: { id: 42, fullName: "acme/api", name: "api", owner: "acme" },
      pullRequest: { number: 7, headSha, baseSha, updatedAt: now },
    },
  });
  const snapshot = await resolveRunMemory(env, job, ledger);
  return { ledger, snapshot };
}
async function publishFinding() {
  const result = await setup();
  await result.ledger.transition(
    runId,
    "running",
    "publishing",
    new Date().toISOString(),
    "publish",
  );
  await result.ledger.savePrFindings(prKey, [tracked], runId);
  await result.ledger.recordReviewDecision(runId, {
    verdictPolicy: { mediumSeverityThreshold: 1 },
    output: output.output,
    headSha,
    isDegraded: false,
    scopeStatus: "complete",
    shardsAnalyzed: 1,
    totalShards: 1,
  });
  return result;
}
function event(body: string, commentId = 202): ReviewCommentWebhookEvent {
  return {
    action: "created",
    authorAssociation: "COLLABORATOR",
    authorLogin: "alice",
    body,
    commentId,
    createdAt: new Date().toISOString(),
    deliveryId: `github:comment-${commentId}`,
    inReplyToId: 101,
    installationId: 99,
    pullRequestNumber: 7,
    repository: { id: 42, fullName: "acme/api", name: "api", owner: "acme" },
  };
}
function session(permission = "write") {
  return {
    api: {} as never,
    discussionReader: () => {
      throw new Error("Discussion reader unused in this test");
    },
    expectedAuthorLogin: "holon[bot]",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    token: "test-installation-token",
    configurationReader: vi.fn(),
    currentHeadSha: vi.fn(),
    currentPullRequestRefs: vi.fn(),
    pullRequestDiff: vi.fn(),
    repositoryPermission: vi.fn().mockResolvedValue(permission),
  };
}
function publisher() {
  return {
    publish: vi.fn(),
    findCommentByMarker: vi.fn().mockResolvedValue(undefined),
    replyToComment: vi.fn().mockResolvedValue(303),
  };
}
afterEach(() => reset());
it("atomically persists discoveries and an outbox, then delivers once after eviction", async () => {
  const { ledger } = await setup();
  await ledger.saveReviewAnalysis(runId, output);
  await ledger.saveReviewAnalysis(runId, output);
  await evictDurableObject(ledger);
  await runInDurableObject(ledger, (_, state) => {
    expect(
      state.storage.sql.exec("SELECT id FROM memory_outbox").toArray(),
    ).toHaveLength(2);
    const payloads = state.storage.sql
      .exec<{ delivery_json: string }>(
        "SELECT delivery_json FROM memory_outbox",
      )
      .toArray();
    expect(
      payloads.some((row) => row.delivery_json.includes('"excerpt"')),
    ).toBe(false);
  });
  await runInDurableObject(ledger, async (object, state) => {
    state.storage.sql.exec(
      "UPDATE memory_outbox SET next_attempt_at=?",
      new Date(Date.now() - 1000).toISOString(),
    );
    await object.alarm();
  });
  await runInDurableObject(ledger, (_, state) =>
    expect(
      state.storage.sql.exec("SELECT id FROM memory_outbox").toArray(),
    ).toEqual([]),
  );
  const snapshot = await env.REPOSITORY_MEMORIES.getByName("99/42").snapshot(
    { ...identity, runId, headSha, baseSha, pullRequestNumber: 7 },
    "99/42",
  );
  expect(snapshot.observations.map((item) => item.kind).toSorted()).toEqual([
    "finding",
    "investigation",
  ]);
  expect(snapshot.observations.every((item) => item.line === 10)).toBe(true);
});
it("records feedback and its delivery obligation in the same transaction, without creating a permanent exception", async () => {
  const { ledger } = await publishFinding();
  const input = {
    authorAssociation: "COLLABORATOR",
    authorLogin: "alice",
    createdAt: new Date().toISOString(),
    deliveryId: "github:feedback",
    githubCommentId: 202,
    label: "false_positive" as const,
    prKey,
    reason: "The gateway validates authorization before this handler.",
    targetCommentId: 101,
    update: { status: "dismissed" as const },
  };
  await ledger.applyFindingFeedback(input);
  await ledger.applyFindingFeedback(input);
  expect((await ledger.loadPrFindings(prKey))[0]?.status).toBe("dismissed");
  await runInDurableObject(ledger, (_, state) =>
    expect(
      state.storage.sql.exec("SELECT id FROM memory_outbox").toArray(),
    ).toHaveLength(1),
  );
  await runInDurableObject(ledger, async (object, state) => {
    state.storage.sql.exec(
      "UPDATE memory_outbox SET next_attempt_at=?",
      new Date(Date.now() - 1000).toISOString(),
    );
    await object.alarm();
  });
  expect(
    await env.REPOSITORY_MEMORIES.getByName("99/42").list(identity),
  ).toEqual([]);
});
it("discards delayed outbox deliveries after repository removal and reinstallation", async () => {
  const { ledger } = await setup();
  await ledger.saveReviewAnalysis(runId, output);
  const registry = env.PROJECT_IDENTIFICATION_REGISTRY.getByName("99");
  await registry.revoke(99, [42]);
  await registry.restore(99, [42]);
  await runInDurableObject(ledger, async (object, state) => {
    state.storage.sql.exec(
      "UPDATE memory_outbox SET next_attempt_at=?",
      new Date(Date.now() - 1000).toISOString(),
    );
    await object.alarm();
  });
  const name = await registry.register(99, 42);
  const snapshot = await env.REPOSITORY_MEMORIES.getByName(
    name ?? "missing",
  ).snapshot(
    { ...identity, runId, headSha, baseSha, pullRequestNumber: 7 },
    name ?? "missing",
  );
  expect(snapshot.observations).toEqual([]);
});
it("requires current permission for memory commands and never treats association alone as approval", async () => {
  await publishFinding();
  const current = session("read"),
    publish = publisher();
  expect(
    await handleMemoryComment(
      env,
      event(
        "/holon memory propose src | Check the gateway authorization first.",
      ),
      current,
      publish,
    ),
  ).toEqual({ actionTaken: "unauthorized" });
  expect(current.repositoryPermission).toHaveBeenCalledWith(
    "acme",
    "api",
    "alice",
  );
  expect(publish.replyToComment).not.toHaveBeenCalled();
  expect(
    await env.REPOSITORY_MEMORIES.getByName("99/42").list(identity),
  ).toEqual([]);
});
it("handles propose, inspect, approve, list, revoke and redelivery through authenticated ingress", async () => {
  await publishFinding();
  const current = session(),
    publish = publisher();
  const dependencies = {
    createSession: async () => current,
    publisher: publish,
  };
  const testEnv = {
    ...env,
    GITHUB_APP_PRIVATE_KEY_CURRENT: "fixture-private-key",
    GITHUB_APP_ID: "123",
    GITHUB_APP_SLUG: "holon",
  };
  await handleFeedbackCommentWebhook(
    testEnv,
    event(
      "/holon memory propose src | Check gateway authorization before reporting missing checks.",
    ),
    dependencies,
  );
  const rules = await env.REPOSITORY_MEMORIES.getByName("99/42").list(identity);
  const rule = rules[0];
  expect(rule?.state).toBe("proposed");
  if (!rule) throw new Error("Missing proposal");
  await handleFeedbackCommentWebhook(
    testEnv,
    event(`/holon memory inspect ${rule.id} ${rule.digest}`, 203),
    dependencies,
  );
  expect(publish.replyToComment).toHaveBeenLastCalledWith(
    203,
    expect.stringContaining(rule.guidance),
  );
  const approval = event(
    `/holon memory approve ${rule.id} ${rule.digest}`,
    204,
  );
  await handleFeedbackCommentWebhook(testEnv, approval, dependencies);
  vi.mocked(publish.findCommentByMarker).mockResolvedValueOnce(999);
  const replay = await handleFeedbackCommentWebhook(
    testEnv,
    approval,
    dependencies,
  );
  expect(replay.replyPosted).toBe(false);
  await handleFeedbackCommentWebhook(
    testEnv,
    event("/holon memory list", 205),
    dependencies,
  );
  expect(publish.replyToComment).toHaveBeenLastCalledWith(
    205,
    expect.stringContaining("active"),
  );
  await handleFeedbackCommentWebhook(
    testEnv,
    event(`/holon memory revoke ${rule.id} ${rule.digest}`, 206),
    dependencies,
  );
  expect(
    (await env.REPOSITORY_MEMORIES.getByName("99/42").list(identity))[0]?.state,
  ).toBe("revoked");
});
it("ignores malformed, bot and unrelated thread commands", async () => {
  await publishFinding();
  const current = session(),
    publish = publisher();
  expect(
    await handleMemoryComment(
      env,
      event("/holon memory approve latest"),
      current,
      publish,
    ),
  ).toEqual({ actionTaken: "ignored" });
  expect(
    await handleMemoryComment(
      env,
      { ...event("/holon memory list"), authorLogin: "evil[bot]" },
      current,
      publish,
    ),
  ).toEqual({ actionTaken: "ignored" });
  expect(
    await handleMemoryComment(
      env,
      { ...event("/holon memory list"), inReplyToId: 999 },
      current,
      publish,
    ),
  ).toEqual({ actionTaken: "ignored" });
});
it("keeps feedback operational after snapshot expiry while rejecting replay with new memory", async () => {
  const { ledger } = await publishFinding();
  await runInDurableObject(ledger, (_, state) =>
    state.storage.sql.exec("DELETE FROM run_memory_snapshots"),
  );
  await runInDurableObject(ledger, (object) =>
    expect(() => object.loadRunMemory(runId)).toThrow("expired"),
  );
  await ledger.applyFindingFeedback({
    authorLogin: "alice",
    createdAt: new Date().toISOString(),
    deliveryId: "github:late",
    githubCommentId: 202,
    label: "helpful",
    prKey,
    targetCommentId: 101,
  });
  await runInDurableObject(ledger, async (object, state) => {
    state.storage.sql.exec(
      "UPDATE memory_outbox SET next_attempt_at=?",
      new Date(Date.now() - 1000).toISOString(),
    );
    await object.alarm();
  });
  await runInDurableObject(
    env.REPOSITORY_MEMORIES.getByName("99/42"),
    (_, state) =>
      expect(
        state.storage.sql.exec("SELECT id FROM observations").toArray(),
      ).toHaveLength(1),
  );
});

it("keeps failed memory deliveries durable and retries after storage capacity is restored", async () => {
  const { ledger } = await setup();
  await ledger.saveReviewAnalysis(runId, output);
  const memory = env.REPOSITORY_MEMORIES.getByName("99/42");
  await runInDurableObject(memory, (_, state) => {
    state.storage.sql.exec(
      `WITH RECURSIVE sequence(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM sequence WHERE i<10000)
      INSERT INTO observations SELECT 'capacity-'||i,'capacity',7,?,?,? FROM sequence`,
      headSha,
      new Date().toISOString(),
      "{}",
    );
  });
  await runInDurableObject(ledger, async (object, state) => {
    state.storage.sql.exec(
      "UPDATE memory_outbox SET next_attempt_at=?",
      new Date(Date.now() - 1000).toISOString(),
    );
    await object.alarm();
    const pending = state.storage.sql
      .exec<{ attempts: number; next_attempt_at: string }>(
        "SELECT attempts,next_attempt_at FROM memory_outbox",
      )
      .toArray();
    expect(pending).toHaveLength(2);
    expect(
      pending.every(
        (item) =>
          item.attempts === 1 && Date.parse(item.next_attempt_at) > Date.now(),
      ),
    ).toBe(true);
  });
  await evictDurableObject(ledger);
  await runInDurableObject(memory, (_, state) =>
    state.storage.sql.exec("DELETE FROM observations"),
  );
  await runInDurableObject(ledger, async (object, state) => {
    state.storage.sql.exec(
      "UPDATE memory_outbox SET next_attempt_at=?",
      new Date(Date.now() - 1000).toISOString(),
    );
    await object.alarm();
    expect(
      state.storage.sql.exec("SELECT id FROM memory_outbox").toArray(),
    ).toEqual([]);
  });
  await runInDurableObject(memory, (_, state) =>
    expect(
      state.storage.sql.exec("SELECT id FROM observations").toArray(),
    ).toHaveLength(2),
  );
});

it("does not relabel an unreviewed preserved finding as a discovery from the current commit", async () => {
  const { ledger } = await setup();
  const previousHead = "e".repeat(40);
  await ledger.saveReviewAnalysis(runId, {
    ...output,
    investigations: [],
    updatedTrackedFindings: [
      {
        ...tracked,
        lastSeenHeadSha: previousHead,
        lastSeenRunId: `github:42:pr:7:head:${previousHead}:base:${baseSha}`,
      },
    ],
  });
  await runInDurableObject(ledger, (_, state) =>
    expect(
      state.storage.sql.exec("SELECT id FROM memory_outbox").toArray(),
    ).toEqual([]),
  );
});

it("records a rejected proposal without granting future review authority", async () => {
  await publishFinding();
  const current = session(),
    publish = publisher();
  await handleMemoryComment(
    env,
    event(
      "/holon memory propose src | Investigate the gateway before repeating this warning.",
    ),
    current,
    publish,
  );
  const rule = (
    await env.REPOSITORY_MEMORIES.getByName("99/42").list(identity)
  )[0];
  if (!rule) throw new Error("Missing proposal");
  await handleMemoryComment(
    env,
    event(`/holon memory reject ${rule.id} ${rule.digest}`, 203),
    current,
    publish,
  );
  const snapshot = await env.REPOSITORY_MEMORIES.getByName("99/42").snapshot(
    { ...identity, runId, headSha, baseSha, pullRequestNumber: 7 },
    "99/42",
    ["src/index.ts"],
  );
  expect(snapshot.rules).toEqual([]);
  expect(
    (await env.REPOSITORY_MEMORIES.getByName("99/42").list(identity))[0]?.state,
  ).toBe("rejected");
});
