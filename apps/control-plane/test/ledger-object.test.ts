import {
  buildPublicationMarker,
  createPublicationId,
  type PublicationId,
  type PublicationRecord,
  type ReviewRun,
  type RunId,
} from "@holon/domain";
import { identifySnapshot } from "@holon/project-identification";
import {
  createExecutionContext,
  evictDurableObject,
  reset,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import worker from "../src/index.js";

afterEach(() => reset());

const runId =
  `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}` as RunId;
const run: ReviewRun = {
  causalVersion: "2026-08-29T12:00:00.000Z",
  attempt: 0,
  createdAt: "2026-08-29T12:00:00.000Z",
  id: runId,
  prKey: "github:42:pr:7",
  state: "queued",
};

describe("ReviewLedgerObject", () => {
  it("does not expose an accidental public route", async () => {
    const response = await worker.fetch(
      new Request("https://holon.test/missing"),
      env,
      createExecutionContext(),
    );
    expect(response.status).toBe(404);
  });

  it("atomically claims runs and tracks only the latest head", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    await expect(ledger.claimRun(run, "workflow-1")).resolves.toMatchObject({
      outcome: "claimed",
    });
    await expect(ledger.claimRun(run, "workflow-1")).resolves.toMatchObject({
      outcome: "resume",
    });
    await expect(ledger.claimRun(run, "workflow-2")).resolves.toMatchObject({
      outcome: "duplicate",
    });
    await expect(ledger.isLatestRun(runId)).resolves.toBe(true);
    await expect(ledger.runState(runId)).resolves.toBe("queued");

    const newerId =
      `github:42:pr:7:head:${"b".repeat(40)}:base:${"b".repeat(40)}` as RunId;
    await ledger.claimRun({ ...run, id: newerId }, "workflow-3");
    await expect(ledger.isLatestRun(runId)).resolves.toBe(false);
    await expect(ledger.isLatestRun(newerId)).resolves.toBe(true);
  });

  it("atomically supersedes active runs before exposing termination work", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    await ledger.claimRun(run, "workflow-old");
    await ledger.transition(
      runId,
      "queued",
      "running",
      "2026-08-29T12:00:01.000Z",
      "workflow-old:start",
    );
    await ledger.registerCredentialScope({
      containerId: "f".repeat(64),
      installationId: 99,
      repositoryId: 42,
      repositoryName: "api",
      repositoryOwner: "acme",
      runId,
    });

    const newerId =
      `github:42:pr:7:head:${"b".repeat(40)}:base:${"b".repeat(40)}` as RunId;
    const claim = await ledger.claimRun(
      {
        ...run,
        createdAt: "2026-08-29T12:01:01.000Z",
        id: newerId,
        causalVersion: "2026-08-29T12:01:00.000Z",
      },
      "workflow-new",
    );

    expect(claim).toEqual({
      outcome: "claimed",
      supersededWorkflows: [{ runId, workflowInstanceId: "workflow-old" }],
    });
    await expect(ledger.runState(runId)).resolves.toBe("obsolete");
    await expect(ledger.isLatestRun(newerId)).resolves.toBe(true);
    await expect(ledger.cleanupState(runId)).resolves.toBeDefined();
    await runInDurableObject(ledger, (_object, state) => {
      expect(
        state.storage.sql
          .exec<{ state: string }>(
            "SELECT state FROM workflow_supersessions WHERE superseded_run_id = ?",
            runId,
          )
          .one().state,
      ).toBe("pending");
    });
  });

  it("hands every still-pending older cancellation to the causally latest run", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    await ledger.claimRun(run, "workflow-a");
    await ledger.transition(
      runId,
      "queued",
      "running",
      "2026-08-29T12:00:01.000Z",
      "workflow-a:start",
    );

    const middleId =
      `github:42:pr:7:head:${"b".repeat(40)}:base:${"b".repeat(40)}` as RunId;
    await ledger.claimRun(
      {
        ...run,
        createdAt: "2026-08-29T12:01:01.000Z",
        id: middleId,
        causalVersion: "2026-08-29T12:01:00.000Z",
      },
      "workflow-b",
    );
    await ledger.transition(
      middleId,
      "queued",
      "running",
      "2026-08-29T12:01:02.000Z",
      "workflow-b:start",
    );

    const newestId =
      `github:42:pr:7:head:${"c".repeat(40)}:base:${"b".repeat(40)}` as RunId;
    const claim = await ledger.claimRun(
      {
        ...run,
        createdAt: "2026-08-29T12:02:01.000Z",
        id: newestId,
        causalVersion: "2026-08-29T12:02:00.000Z",
      },
      "workflow-c",
    );

    expect(claim).toEqual({
      outcome: "claimed",
      supersededWorkflows: [
        { runId, workflowInstanceId: "workflow-a" },
        { runId: middleId, workflowInstanceId: "workflow-b" },
      ],
    });
    await expect(ledger.runState(middleId)).resolves.toBe("obsolete");
    await expect(ledger.isLatestRun(newestId)).resolves.toBe(true);
  });

  it("supersedes a retryable failed run without blocking the latest head", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    await ledger.claimRun(run, "workflow-retryable");
    await ledger.transition(
      runId,
      "queued",
      "running",
      "2026-08-29T12:00:01.000Z",
      "workflow-retryable:start",
    );
    await ledger.transition(
      runId,
      "running",
      "failed_retryable",
      "2026-08-29T12:00:02.000Z",
      "workflow-retryable:fail",
    );

    const newerId =
      `github:42:pr:7:head:${"b".repeat(40)}:base:${"b".repeat(40)}` as RunId;
    await expect(
      ledger.claimRun(
        {
          ...run,
          createdAt: "2026-08-29T12:01:01.000Z",
          id: newerId,
          causalVersion: "2026-08-29T12:01:00.000Z",
        },
        "workflow-new-after-retry",
      ),
    ).resolves.toMatchObject({ outcome: "claimed" });
    await expect(ledger.runState(runId)).resolves.toBe("obsolete");
  });

  it("does not let a delayed older delivery supersede the causally newer head", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    const newerId =
      `github:42:pr:7:head:${"b".repeat(40)}:base:${"b".repeat(40)}` as RunId;
    await ledger.claimRun(
      {
        ...run,
        createdAt: "2026-08-29T12:02:00.000Z",
        id: newerId,
        causalVersion: "2026-08-29T12:02:00.000Z",
      },
      "workflow-newer",
    );
    const delayed = await ledger.claimRun(
      { ...run, causalVersion: "2026-08-29T12:00:00.000Z" },
      "workflow-delayed",
    );

    expect(delayed).toEqual({
      outcome: "duplicate",
      supersededWorkflows: [],
    });
    await expect(ledger.isLatestRun(newerId)).resolves.toBe(true);
    await expect(ledger.isLatestRun(runId)).resolves.toBe(false);
  });

  it("uses webhook receipt time before the run id when causal versions tie", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    const smallerId =
      `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}` as RunId;
    const largerId =
      `github:42:pr:7:head:${"b".repeat(40)}:base:${"b".repeat(40)}` as RunId;
    await ledger.claimRun(
      {
        ...run,
        createdAt: "2026-08-29T12:00:01.000Z",
        id: largerId,
        causalVersion: run.createdAt,
      },
      "workflow-larger",
    );
    await ledger.claimRun(
      {
        ...run,
        createdAt: "2026-08-29T12:00:02.000Z",
        id: smallerId,
        causalVersion: run.createdAt,
      },
      "workflow-smaller",
    );

    await expect(ledger.isLatestRun(largerId)).resolves.toBe(false);
    await expect(ledger.isLatestRun(smallerId)).resolves.toBe(true);
  });

  it("uses the run id only as the final deterministic causal tie-break", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    const smallerId =
      `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}` as RunId;
    const largerId =
      `github:42:pr:7:head:${"b".repeat(40)}:base:${"b".repeat(40)}` as RunId;
    await ledger.claimRun(
      { ...run, id: smallerId, causalVersion: run.createdAt },
      "workflow-smaller",
    );
    await ledger.claimRun(
      { ...run, id: largerId, causalVersion: run.createdAt },
      "workflow-larger",
    );

    await expect(ledger.isLatestRun(largerId)).resolves.toBe(true);
    await expect(ledger.isLatestRun(smallerId)).resolves.toBe(false);
  });

  it("preserves the current schema and run state across eviction", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    await ledger.claimRun(run, "workflow-before-upgrade");
    await evictDurableObject(ledger);

    await expect(ledger.isLatestRun(runId)).resolves.toBe(true);
    await runInDurableObject(ledger, (object, state) => {
      expect(
        state.storage.sql
          .exec<{ version: number }>(
            "SELECT version FROM schema_migrations ORDER BY version",
          )
          .toArray(),
      ).toEqual([
        { version: 1 },
        { version: 2 },
        { version: 3 },
        { version: 4 },
        { version: 5 },
        { version: 6 },
        { version: 7 },
        { version: 8 },
        { version: 9 },
        { version: 10 },
        { version: 11 },
        { version: 12 },
        { version: 13 },
        { version: 14 },
        { version: 15 },
        { version: 16 },
        { version: 17 },
        { version: 18 },
        { version: 19 },
      ]);
      expect(
        state.storage.sql
          .exec<{ causal_version: string }>(
            "SELECT causal_version FROM runs WHERE id = ?",
            runId,
          )
          .one().causal_version,
      ).toBe(run.createdAt);
      expect(object.checkRunId(runId)).toBeUndefined();
      expect(
        object.checkRunId(
          "github:42:pr:99:head:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:base:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        ),
      ).toBeUndefined();
      object.recordCheckRunId(runId, 101);
      expect(object.checkRunId(runId)).toBe(101);
    });
  });

  it("uses conditional state transitions and counts execution attempts", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    await ledger.claimRun(run, "workflow-1");
    await expect(
      ledger.transition(
        runId,
        "queued",
        "running",
        "2026-08-29T12:00:01.000Z",
        "start",
      ),
    ).resolves.toBeUndefined();
    await runInDurableObject(ledger, async (object) => {
      await expect(
        object.transition(
          runId,
          "queued",
          "running",
          "2026-08-29T12:00:02.000Z",
          "different-start",
        ),
      ).rejects.toThrow();
    });
    await ledger.transition(
      runId,
      "running",
      "failed_retryable",
      "2026-08-29T12:00:03.000Z",
      "fail",
    );
    await expect(ledger.claimRun(run, "workflow-1")).resolves.toMatchObject({
      outcome: "resume",
    });
    await expect(
      ledger.markTerminalAndRequestCleanup(
        runId,
        "2026-08-29T12:00:04.000Z",
        false,
      ),
    ).resolves.toBe(true);
    await expect(
      ledger.markTerminalAndRequestCleanup(
        runId,
        "2026-08-29T12:00:05.000Z",
        false,
      ),
    ).resolves.toBe(false);
    await expect(ledger.claimRun(run, "workflow-1")).resolves.toMatchObject({
      outcome: "duplicate",
    });
    await runInDurableObject(ledger, async (object) => {
      await expect(
        object.transition(
          runId,
          "failed_terminal",
          "running",
          "2026-08-29T12:00:05.000Z",
          "invalid-terminal-resume",
        ),
      ).rejects.toThrow("Invalid review run transition");
    });
  });

  it("claims, reconciles and completes an idempotent publication", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    await ledger.claimRun(run, "workflow-publication");
    await ledger.transition(
      runId,
      "queued",
      "running",
      "2026-08-29T12:00:01.000Z",
      "workflow-publication:start",
    );
    await ledger.transition(
      runId,
      "running",
      "publishing",
      "2026-08-29T12:00:02.000Z",
      "workflow-publication:publish",
    );
    const findingId = `finding:${"c".repeat(64)}` as const;
    const id = `${runId}:publication:${findingId}` as PublicationId;
    const publication: PublicationRecord = {
      findingId,
      id,
      kind: "inline",
      marker: `<!-- holon;run=${encodeURIComponent(runId)};finding=${encodeURIComponent(findingId)} -->`,
      runId,
      state: "publishing",
    };

    await expect(ledger.claimPublication(publication)).resolves.toMatchObject({
      outcome: "claimed",
    });
    await expect(ledger.claimPublication(publication)).resolves.toMatchObject({
      outcome: "reconcile",
    });
    await ledger.completePublication(id, 123);
    await expect(ledger.completePublication(id, 123)).resolves.toBeUndefined();
    await expect(ledger.claimPublication(publication)).resolves.toMatchObject({
      outcome: "published",
      record: { githubCommentId: 123 },
    });
    await runInDurableObject(ledger, async (object) => {
      await expect(object.completePublication(id, 456)).rejects.toThrow();
    });
  });

  it("denies publication and credentials when a run is stale or terminal", async () => {
    const platformContainerId = "f".repeat(64);
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    await ledger.claimRun(run, "workflow-authorized");
    await ledger.transition(
      runId,
      "queued",
      "running",
      "2026-08-29T12:00:01.000Z",
      "workflow-authorized:start",
    );
    await ledger.registerCredentialScope({
      containerId: platformContainerId,
      installationId: 99,
      repositoryId: 42,
      repositoryName: "api",
      repositoryOwner: "acme",
      runId,
    });
    await expect(
      ledger.authorizeCredential({
        containerId: platformContainerId,
        installationId: 99,
        repositoryId: 42,
        repositoryName: "api",
        repositoryOwner: "acme",
        runId,
      }),
    ).resolves.toBe(true);
    await expect(
      ledger.authorizeCredential({
        containerId: "e".repeat(64),
        installationId: 99,
        repositoryId: 42,
        repositoryName: "api",
        repositoryOwner: "acme",
        runId,
      }),
    ).resolves.toBe(false);

    const newerId =
      `github:42:pr:7:head:${"b".repeat(40)}:base:${"b".repeat(40)}` as RunId;
    await ledger.claimRun(
      {
        ...run,
        createdAt: "2026-08-29T12:01:00.000Z",
        id: newerId,
        causalVersion: "2026-08-29T12:01:00.000Z",
      },
      "workflow-newer",
    );
    await expect(ledger.authorizeMutation(runId, "review")).resolves.toBe(
      false,
    );
    await expect(
      ledger.authorizeCredential({
        containerId: platformContainerId,
        installationId: 99,
        repositoryId: 42,
        repositoryName: "api",
        repositoryOwner: "acme",
        runId,
      }),
    ).resolves.toBe(false);
  });

  it("persists cleanup before the alarm and completes it idempotently", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    await ledger.claimRun(run, "workflow-cleanup");
    await ledger.transition(
      runId,
      "queued",
      "running",
      "2026-08-29T12:00:01.000Z",
      "workflow-cleanup:start",
    );
    await ledger.registerCredentialScope({
      containerId: `r-16-7-${"a".repeat(40)}`,
      installationId: 99,
      repositoryId: 42,
      repositoryName: "api",
      repositoryOwner: "acme",
      runId,
    });
    await ledger.transitionAndRequestCleanup(
      runId,
      "running",
      "obsolete",
      "2026-08-29T12:00:02.000Z",
      "workflow-cleanup:obsolete",
    );

    const scheduled = await ledger.cleanupState(runId);
    expect(scheduled).toBeDefined();
    expect(["pending", "completed"]).toContain(scheduled?.state);
    // Miniflare may eagerly dispatch an alarm scheduled for Date.now(). The
    // helper therefore returns either true (we dispatched it) or false (the
    // runtime already did), while the durable state is the behavioral oracle.
    await runDurableObjectAlarm(ledger);
    await expect(ledger.cleanupState(runId)).resolves.toEqual({
      attempts: 1,
      state: "completed",
    });
    await runInDurableObject(ledger, (_object, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM credential_scopes WHERE run_id = ?",
            runId,
          )
          .one().count,
      ).toBe(0);
    });
    await expect(runDurableObjectAlarm(ledger)).resolves.toBe(false);
  });

  it("replays the same transition operation exactly once", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    await ledger.claimRun(run, "workflow-1");
    await ledger.transition(
      runId,
      "queued",
      "running",
      "2026-08-29T12:00:01.000Z",
      "workflow-1:start",
    );
    await expect(
      ledger.transition(
        runId,
        "queued",
        "running",
        "2026-08-29T12:00:02.000Z",
        "workflow-1:start",
      ),
    ).resolves.toBeUndefined();
    await runInDurableObject(ledger, async (object) => {
      await expect(
        object.transition(
          runId,
          "running",
          "publishing",
          "2026-08-29T12:00:03.000Z",
          "workflow-1:start",
        ),
      ).rejects.toThrow("reused");
    });
  });

  it("persists, updates, and retrieves tracked PR findings with comment IDs", async () => {
    const prKey = "github:42:pr:7" as const;
    const ledger = env.REVIEW_LEDGERS.getByName(prKey);
    const fingerprint = `fp:${"c".repeat(64)}` as const;

    const initialFinding = {
      confidence: 0.73,
      diagnostic: "SQL injection vulnerability in query builder.",
      filePath: "src/db/query.ts",
      fingerprint,
      evidenceFingerprint: fingerprint.slice(3),
      firstSeenHeadSha: "a".repeat(40),
      firstSeenRunId: runId,
      githubCommentId: 101,
      lastSeenHeadSha: "a".repeat(40),
      lastSeenRunId: runId,
      line: 45,
      prKey,
      severity: "high" as const,
      status: "new" as const,
      updatedAt: "2026-09-02T12:00:00.000Z",
    };

    await authorizeFindingWriter(ledger, run);
    await ledger.savePrFindings(prKey, [initialFinding], runId);

    let loaded = await ledger.loadPrFindings(prKey);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(initialFinding);

    // Update to persistent on a subsequent commit, line shift to 50
    const persistentFinding = {
      ...initialFinding,
      lastSeenHeadSha: "b".repeat(40),
      lastSeenRunId:
        `github:42:pr:7:head:${"b".repeat(40)}:base:${"b".repeat(40)}` as const,
      line: 50,
      status: "persistent" as const,
      updatedAt: "2026-09-02T13:00:00.000Z",
    };

    await ledger.savePrFindings(prKey, [persistentFinding], runId);
    loaded = await ledger.loadPrFindings(prKey);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.status).toBe("persistent");
    expect(loaded[0]?.line).toBe(50);
    expect(loaded[0]?.githubCommentId).toBe(101);

    // Update to resolved
    const resolvedFinding = {
      ...persistentFinding,
      status: "resolved" as const,
      updatedAt: "2026-09-02T14:00:00.000Z",
    };

    await ledger.savePrFindings(prKey, [resolvedFinding], runId);
    loaded = await ledger.loadPrFindings(prKey);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.status).toBe("resolved");
    expect(loaded[0]?.githubCommentId).toBe(101);

    // Test findFindingByCommentId
    const found = await ledger.findFindingByCommentId(prKey, 101);
    expect(found).toBeDefined();
    expect(found?.fingerprint).toBe(initialFinding.fingerprint);

    const notFound = await ledger.findFindingByCommentId(prKey, 9999);
    expect(notFound).toBeUndefined();

    // Update to dismissed
    const dismissedFinding = {
      ...resolvedFinding,
      status: "dismissed" as const,
      updatedAt: "2026-09-02T15:00:00.000Z",
    };
    await ledger.savePrFindings(prKey, [dismissedFinding], runId);
    loaded = await ledger.loadPrFindings(prKey);
    expect(loaded[0]?.status).toBe("dismissed");

    // Test recordFindingFeedback and loadFindingFeedbacks
    await ledger.recordFindingFeedback(prKey, {
      authorLogin: "alice",
      createdAt: "2026-09-02T15:05:00.000Z",
      fingerprint: initialFinding.fingerprint,
      githubCommentId: 101,
      label: "false_positive",
      prKey,
      reason: "Safe by construction",
    });

    const feedbacks = await ledger.loadFindingFeedbacks(prKey);
    expect(feedbacks).toHaveLength(1);
    expect(feedbacks[0]).toMatchObject({
      authorLogin: "alice",
      fingerprint: initialFinding.fingerprint,
      label: "false_positive",
      reason: "Safe by construction",
    });

    const scopedFeedbacks = await ledger.loadFindingFeedbacks(
      prKey,
      initialFinding.fingerprint,
    );
    expect(scopedFeedbacks).toHaveLength(1);
  });

  it("applies feedback once and returns the persisted review decision", async () => {
    const prKey = "github:42:pr:7" as const;
    const ledger = env.REVIEW_LEDGERS.getByName(prKey);
    const fingerprint = `fp:${"d".repeat(64)}` as const;
    await ledger.claimRun(run, "wf-feedback");
    await expect(
      ledger.loadLatestReviewDecision(prKey),
    ).resolves.toBeUndefined();
    await runInDurableObject(ledger, (object) => {
      object.recordCheckRunId(runId, 404);
    });
    await ledger.recordReviewDecision(runId, {
      verdictPolicy: { mediumSeverityThreshold: 1 },
      output: { language: "en", detail: "concise", maxInlineComments: 40 },
      headSha: "a".repeat(40),
      isDegraded: true,
      scopeStatus: "partial_by_failure",
      shardsAnalyzed: 1,
      totalShards: 2,
    });
    await evictDurableObject(ledger);
    await expect(ledger.loadLatestReviewDecision(prKey)).resolves.toMatchObject(
      { verdictPolicy: { mediumSeverityThreshold: 1 } },
    );
    await authorizeFindingWriter(ledger, run);
    await ledger.savePrFindings(
      prKey,
      [
        {
          confidence: 0.62,
          diagnostic: "A persisted finding with enough detail.",
          filePath: "src/example.ts",
          fingerprint,
          evidenceFingerprint: fingerprint.slice(3),
          firstSeenHeadSha: "a".repeat(40),
          firstSeenRunId: runId,
          githubCommentId: 202,
          lastSeenHeadSha: "a".repeat(40),
          lastSeenRunId: runId,
          line: 12,
          prKey,
          severity: "high",
          status: "new",
          updatedAt: "2026-09-03T12:00:00.000Z",
        },
      ],
      runId,
    );

    const input = {
      authorAssociation: "MEMBER",
      authorLogin: "alice",
      createdAt: "2026-09-03T12:05:00.000Z",
      deliveryId: "github:delivery-123",
      githubCommentId: 303,
      label: "false_positive" as const,
      prKey,
      targetCommentId: 202,
      update: { status: "dismissed" as const },
    };
    const first = await ledger.applyFindingFeedback(input);
    await ledger.completeFeedbackReply(input.deliveryId, 909);
    const duplicate = await ledger.applyFindingFeedback(input);

    expect(first).toMatchObject({
      activeFindings: [],
      decision: {
        output: { language: "en", detail: "concise", maxInlineComments: 40 },
        checkRunId: 404,
        headSha: "a".repeat(40),
        isDegraded: true,
        runId,
        scopeStatus: "partial_by_failure",
        shardsAnalyzed: 1,
        totalShards: 2,
      },
      outcome: "applied",
    });
    expect(duplicate).toMatchObject({
      outcome: "duplicate",
      replyCommentId: 909,
    });
    await expect(ledger.loadFindingFeedbacks(prKey)).resolves.toHaveLength(1);
    await expect(ledger.loadPrFindings(prKey)).resolves.toMatchObject([
      { confidence: 0.62, status: "dismissed" },
    ]);

    // The review loaded its baseline before the human response arrived.
    const dismissed = (await ledger.loadPrFindings(prKey))[0]!;
    await ledger.savePrFindings(
      prKey,
      [{ ...dismissed, status: "persistent" }],
      runId,
    );
    await expect(ledger.loadPrFindings(prKey)).resolves.toMatchObject([
      { status: "dismissed" },
    ]);
    await ledger.applyFindingFeedback({
      ...input,
      deliveryId: "github:severity-feedback",
      label: "wrong_severity",
      targetSeverity: "low",
      update: { severity: "low" },
    });
    await ledger.savePrFindings(
      prKey,
      [{ ...dismissed, severity: "critical", status: "persistent" }],
      runId,
    );
    await expect(ledger.loadPrFindings(prKey)).resolves.toMatchObject([
      { status: "dismissed", severity: "low" },
    ]);
  });

  it("rejects claimPublication when run is not in publishing state", async () => {
    const prKey = "github:42:pr:7" as const;
    const ledger = env.REVIEW_LEDGERS.getByName(prKey);
    await ledger.claimRun(run, "wf-unauth-pub");

    await runInDurableObject(ledger, async (object) => {
      let threw = false;
      try {
        await object.claimPublication({
          findingId: "summary",
          id: createPublicationId(runId, "summary"),
          kind: "summary",
          marker: buildPublicationMarker(runId, "summary"),
          runId,
          state: "publishing",
        });
      } catch (err: unknown) {
        threw = true;
        expect((err as Error).message).toBe("Publication is not authorized");
      }
      expect(threw).toBe(true);
    });
  });

  it("retries cleanup with exponential backoff on failure", async () => {
    const cleanupPrKey = "github:42:pr:999" as const;
    const cleanupRunId =
      `github:42:pr:999:head:${"c".repeat(40)}:base:${"b".repeat(40)}` as const;
    const cleanupRun = { ...run, id: cleanupRunId, prKey: cleanupPrKey };
    const ledger = env.REVIEW_LEDGERS.getByName(cleanupPrKey);
    await ledger.claimRun(cleanupRun, "wf-cleanup-fail");
    await ledger.transition(
      cleanupRunId,
      "queued",
      "running",
      "2026-08-29T12:00:00.000Z",
      "op-running",
    );
    await ledger.transitionAndRequestCleanup(
      cleanupRunId,
      "running",
      "obsolete",
      "2026-08-29T12:00:01.000Z",
      "op-cleanup-fail",
    );

    const executor = env.REPOSITORY_EXECUTOR as {
      cleanup: (id: string) => Promise<void>;
    };
    const originalCleanup = executor.cleanup;
    executor.cleanup = () => Promise.reject(new Error("Container stuck"));
    try {
      await runDurableObjectAlarm(ledger);
      await runInDurableObject(ledger, (_object, state) => {
        const task = state.storage.sql
          .exec<{ attempts: number }>(
            "SELECT attempts FROM cleanup_tasks WHERE run_id = ?",
            cleanupRunId,
          )
          .one();
        expect(task.attempts).toBeGreaterThanOrEqual(1);
      });
    } finally {
      executor.cleanup = originalCleanup;
    }
  });
});

it("keeps the identification snapshot immutable and bound to an existing run", async () => {
  const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
  const result = await identifySnapshot({
    snapshotSha: "a".repeat(40),
    policyDigest: "p",
    modelRevision: "m",
    files: [],
  });
  await runInDurableObject(ledger, async (instance) => {
    await expect(
      instance.saveProjectIdentification(runId, result),
    ).rejects.toThrow("unavailable");
  });
  await ledger.claimRun(run, "identification-immutable");
  await ledger.saveProjectIdentification(runId, result);
  await ledger.saveProjectIdentification(runId, result);
  await runInDurableObject(ledger, async (instance) => {
    await expect(
      instance.saveProjectIdentification(runId, {
        ...result,
        snapshotSha: "b".repeat(40),
      }),
    ).rejects.toThrow("mismatch");
    await expect(
      instance.saveProjectIdentification(runId, {
        ...result,
        detectorRevision: "changed",
      }),
    ).rejects.toThrow("already recorded");
  });
});

it("rejects delayed finding writes from a superseded run inside the ledger transaction", async () => {
  const ledger = env.REVIEW_LEDGERS.getByName(run.prKey);
  await ledger.claimRun(run, "old-workflow");
  await ledger.transition(
    runId,
    "queued",
    "running",
    "2026-09-27T12:00:00Z",
    "old-start",
  );
  await ledger.transition(
    runId,
    "running",
    "publishing",
    "2026-09-27T12:00:01Z",
    "old-publish",
  );
  const finding = {
    confidence: 0.95,
    diagnostic: "An unconditional write bypasses authorization.",
    filePath: "a.ts",
    fingerprint: `fp:${"d".repeat(64)}` as const,
    evidenceFingerprint: "d".repeat(64),
    firstSeenHeadSha: "a".repeat(40),
    firstSeenRunId: runId,
    lastSeenHeadSha: "a".repeat(40),
    lastSeenRunId: runId,
    line: 1,
    prKey: run.prKey,
    severity: "high" as const,
    status: "new" as const,
    updatedAt: "2026-09-27T12:00:00Z",
  };
  await ledger.savePrFindings(run.prKey, [finding], runId);
  const nextId: RunId = `${run.prKey}:head:${"b".repeat(40)}:base:${"b".repeat(40)}`;
  await ledger.claimRun(
    {
      ...run,
      id: nextId,
      causalVersion: "2026-09-27T12:01:00Z",
      createdAt: "2026-09-27T12:01:01Z",
    },
    "new-workflow",
  );
  await ledger.transition(
    nextId,
    "queued",
    "running",
    "2026-09-27T12:01:02Z",
    "new-start",
  );
  await ledger.transition(
    nextId,
    "running",
    "publishing",
    "2026-09-27T12:01:03Z",
    "new-publish",
  );
  await ledger.savePrFindings(
    run.prKey,
    [
      {
        ...finding,
        lastSeenRunId: nextId,
        lastSeenHeadSha: "b".repeat(40),
        status: "resolved",
        updatedAt: "2026-09-27T12:01:04Z",
      },
    ],
    nextId,
  );
  await runInDurableObject(ledger, (object) => {
    expect(() => object.savePrFindings(run.prKey, [finding], runId)).toThrow(
      "no longer authoritative",
    );
  });
  expect((await ledger.loadPrFindings(run.prKey))[0]).toMatchObject({
    lastSeenRunId: nextId,
    status: "resolved",
  });
});

async function authorizeFindingWriter(
  ledger: DurableObjectStub<
    import("../src/ledger/ledger-object.js").ReviewLedgerObject
  >,
  fixture: ReviewRun,
): Promise<void> {
  await ledger.claimRun(fixture, "finding-fixture");
  await ledger.transition(
    fixture.id,
    "queued",
    "running",
    fixture.createdAt,
    `${fixture.id}:fixture-start`,
  );
  await ledger.transition(
    fixture.id,
    "running",
    "publishing",
    fixture.createdAt,
    `${fixture.id}:fixture-publish`,
  );
}
