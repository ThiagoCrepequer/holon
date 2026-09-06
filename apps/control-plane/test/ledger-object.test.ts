import {
  buildAdminProjectionEventV1,
  type StepExecutionNode,
} from "@holon/contracts";
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

interface LedgerTestInternal {
  readonly ctx: { readonly storage: { readonly sql: SqlStorage } };
  env: Cloudflare.Env;
  processDueProjection(now: string): Promise<void>;
}

afterEach(() => reset());

const runId = `github:42:pr:7:head:${"a".repeat(40)}` as RunId;
const run: ReviewRun = {
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
    await expect(ledger.claimRun(run, "workflow-1")).resolves.toBe("claimed");
    await expect(ledger.claimRun(run, "workflow-1")).resolves.toBe("resume");
    await expect(ledger.claimRun(run, "workflow-2")).resolves.toBe("duplicate");
    await expect(ledger.isLatestRun(runId)).resolves.toBe(true);
    await expect(ledger.runState(runId)).resolves.toBe("queued");

    const newerId = `github:42:pr:7:head:${"b".repeat(40)}` as RunId;
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

    const newerId = `github:42:pr:7:head:${"b".repeat(40)}` as RunId;
    const claim = await ledger.claimRunV2(
      {
        ...run,
        createdAt: "2026-08-29T12:01:01.000Z",
        id: newerId,
      },
      "workflow-new",
      "2026-08-29T12:01:00.000Z",
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

    const middleId = `github:42:pr:7:head:${"b".repeat(40)}` as RunId;
    await ledger.claimRunV2(
      {
        ...run,
        createdAt: "2026-08-29T12:01:01.000Z",
        id: middleId,
      },
      "workflow-b",
      "2026-08-29T12:01:00.000Z",
    );
    await ledger.transition(
      middleId,
      "queued",
      "running",
      "2026-08-29T12:01:02.000Z",
      "workflow-b:start",
    );

    const newestId = `github:42:pr:7:head:${"c".repeat(40)}` as RunId;
    const claim = await ledger.claimRunV2(
      {
        ...run,
        createdAt: "2026-08-29T12:02:01.000Z",
        id: newestId,
      },
      "workflow-c",
      "2026-08-29T12:02:00.000Z",
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

    const newerId = `github:42:pr:7:head:${"b".repeat(40)}` as RunId;
    await expect(
      ledger.claimRunV2(
        {
          ...run,
          createdAt: "2026-08-29T12:01:01.000Z",
          id: newerId,
        },
        "workflow-new-after-retry",
        "2026-08-29T12:01:00.000Z",
      ),
    ).resolves.toMatchObject({ outcome: "claimed" });
    await expect(ledger.runState(runId)).resolves.toBe("obsolete");
  });

  it("does not let a delayed older delivery supersede the causally newer head", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    const newerId = `github:42:pr:7:head:${"b".repeat(40)}` as RunId;
    await ledger.claimRun(
      { ...run, createdAt: "2026-08-29T12:02:00.000Z", id: newerId },
      "workflow-newer",
      "2026-08-29T12:02:00.000Z",
    );
    const delayed = await ledger.claimRunV2(
      run,
      "workflow-delayed",
      "2026-08-29T12:00:00.000Z",
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
    const smallerId = `github:42:pr:7:head:${"a".repeat(40)}` as RunId;
    const largerId = `github:42:pr:7:head:${"b".repeat(40)}` as RunId;
    await ledger.claimRun(
      { ...run, createdAt: "2026-08-29T12:00:01.000Z", id: largerId },
      "workflow-larger",
      run.createdAt,
    );
    await ledger.claimRun(
      { ...run, createdAt: "2026-08-29T12:00:02.000Z", id: smallerId },
      "workflow-smaller",
      run.createdAt,
    );

    await expect(ledger.isLatestRun(largerId)).resolves.toBe(false);
    await expect(ledger.isLatestRun(smallerId)).resolves.toBe(true);
  });

  it("uses the run id only as the final deterministic causal tie-break", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    const smallerId = `github:42:pr:7:head:${"a".repeat(40)}` as RunId;
    const largerId = `github:42:pr:7:head:${"b".repeat(40)}` as RunId;
    await ledger.claimRun(
      { ...run, id: smallerId },
      "workflow-smaller",
      run.createdAt,
    );
    await ledger.claimRun(
      { ...run, id: largerId },
      "workflow-larger",
      run.createdAt,
    );

    await expect(ledger.isLatestRun(largerId)).resolves.toBe(true);
    await expect(ledger.isLatestRun(smallerId)).resolves.toBe(false);
  });

  it("upgrades the executable MVP ledger schema through versioned migrations", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    await ledger.claimRun(run, "workflow-before-upgrade");
    await runInDurableObject(ledger, (_object, state) => {
      state.storage.sql.exec(`
        DROP TABLE schema_migrations;
        DROP TABLE cleanup_tasks;
        DROP TABLE credential_scopes;
        DROP TABLE IF EXISTS pr_findings;
        DROP TABLE IF EXISTS ci_evidences;
        DROP TABLE IF EXISTS finding_feedbacks;
        DROP TABLE IF EXISTS workflow_supersessions;
        DROP TABLE IF EXISTS run_telemetry;
        DROP TABLE IF EXISTS projection_tasks;
        ALTER TABLE runs RENAME TO runs_v2;
        CREATE TABLE runs (
          id TEXT PRIMARY KEY,
          pr_key TEXT NOT NULL,
          state TEXT NOT NULL,
          attempt INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          workflow_instance_id TEXT NOT NULL,
          updated_at TEXT
        );
        INSERT INTO runs (
          id, pr_key, state, attempt, created_at, workflow_instance_id, updated_at
        ) SELECT
          id, pr_key, state, attempt, created_at, workflow_instance_id, updated_at
        FROM runs_v2;
        DROP TABLE runs_v2;
      `);
    });
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
          "github:42:pr:99:head:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
    await expect(ledger.claimRun(run, "workflow-1")).resolves.toBe("resume");
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
    await expect(ledger.claimRun(run, "workflow-1")).resolves.toBe("duplicate");
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

  it("schedules recovery for a projection whose processing lease expires after eviction", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    const event = await buildAdminProjectionEventV1({
      headSha: "a".repeat(40),
      prKey: "github:42:pr:7",
      projectedFrom: "workflow",
      projectionRequestedAt: new Date().toISOString(),
      pullRequestNumber: 7,
      recordVersion: 1,
      repository: { id: 42, name: "api", owner: "acme" },
      reviewPhaseReached: "publishing",
      runId,
      schemaVersion: 1,
      scopeStatus: "complete",
      telemetry: {
        estimatedCostMicroUsd: 0,
        executionDurationMs: 1,
        inputTokens: 0,
        isDegraded: false,
        outputTokens: 0,
        pricingModel: "unknown",
        reasoningTokens: null,
        reviewAdmissionQueueWaitMs: 0,
        shardsCount: 1,
        toolCallsCount: 0,
      },
      terminalState: "completed",
      timestamps: {
        analysisStartedAt: null,
        terminalAt: new Date().toISOString(),
        webhookReceivedAt: new Date().toISOString(),
        workflowStartedAt: new Date().toISOString(),
      },
      verdict: "APPROVE",
    });
    await ledger.recordProjectionTask(event);

    const leaseExpiresAt = Date.now() + 60_000;
    await runInDurableObject(ledger, async (_object, state) => {
      state.storage.sql.exec(
        "UPDATE projection_tasks SET state = 'processing', lease_expires_at = ? WHERE run_id = ?",
        new Date(leaseExpiresAt).toISOString(),
        runId,
      );
      await state.storage.deleteAlarm();
    });
    await evictDurableObject(ledger);

    await ledger.recordProjectionTask(event);
    await runInDurableObject(ledger, async (_object, state) => {
      expect(await state.storage.getAlarm()).toBe(leaseExpiresAt);
    });
  });

  it("prunes completed and exhausted projection tasks after their retention windows", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    const now = Date.now();
    await runInDurableObject(ledger, async (_object, state) => {
      const insert = (
        id: string,
        stateName: "completed" | "exhausted",
        ageDays: number,
      ) => {
        const completedAt = new Date(now - ageDays * 86_400_000).toISOString();
        state.storage.sql.exec(
          `INSERT INTO projection_tasks (
             run_id, event_id, payload_json, payload_hash, state, attempts,
             requested_at, next_attempt_at, completed_at
           ) VALUES (?, ?, '{}', ?, ?, 1, ?, ?, ?)`,
          id,
          `event:${id}`,
          "a".repeat(64),
          stateName,
          completedAt,
          completedAt,
          completedAt,
        );
      };
      insert(`github:42:pr:7:head:${"b".repeat(40)}`, "completed", 8);
      insert(`github:42:pr:7:head:${"c".repeat(40)}`, "exhausted", 31);
      await _object.alarm();
    });

    await runInDurableObject(ledger, (_object, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM projection_tasks",
          )
          .one().count,
      ).toBe(0);
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
      marker: `<!-- holon:v1;run=${encodeURIComponent(runId)};finding=${encodeURIComponent(findingId)} -->`,
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

    const newerId = `github:42:pr:7:head:${"b".repeat(40)}` as RunId;
    await ledger.claimRun(
      { ...run, createdAt: "2026-08-29T12:01:00.000Z", id: newerId },
      "workflow-newer",
      "2026-08-29T12:01:00.000Z",
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

  it("atomically bootstraps an exact v1 credential scope once", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    await ledger.claimRun(run, "workflow-v1-bootstrap");
    await ledger.transition(
      runId,
      "queued",
      "running",
      "2026-08-29T12:00:01.000Z",
      "workflow-v1-bootstrap:start",
    );
    const v1Request = {
      containerId: `r-16-7-${"a".repeat(40)}`,
      repositoryId: 42,
      repositoryName: "api",
      repositoryOwner: "acme",
      runId,
    };
    await expect(ledger.canBootstrapCredentialScope(v1Request)).resolves.toBe(
      true,
    );
    await expect(
      ledger.bootstrapCredentialScope({ ...v1Request, installationId: 99 }),
    ).resolves.toBe(true);
    await expect(
      ledger.bootstrapCredentialScope({ ...v1Request, installationId: 99 }),
    ).resolves.toBe(true);
    await expect(
      ledger.bootstrapCredentialScope({
        ...v1Request,
        installationId: 99,
        repositoryOwner: "other",
      }),
    ).resolves.toBe(false);
    await expect(
      ledger.canBootstrapCredentialScope({
        ...v1Request,
        containerId: "different",
      }),
    ).resolves.toBe(false);
    await expect(ledger.bootstrapCredentialScope(v1Request)).resolves.toBe(
      false,
    );
    await expect(
      ledger.canBootstrapCredentialScope({
        ...v1Request,
        runId: "github:42:pr:7:head:0000000000000000000000000000000000000000",
      }),
    ).resolves.toBe(false);
    await expect(
      ledger.canBootstrapCredentialScope({
        ...v1Request,
        containerId: "",
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

    await ledger.savePrFindings(prKey, [initialFinding]);

    let loaded = await ledger.loadPrFindings(prKey);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(initialFinding);

    // Update to persistent on a subsequent commit, line shift to 50
    const persistentFinding = {
      ...initialFinding,
      lastSeenHeadSha: "b".repeat(40),
      lastSeenRunId: `github:42:pr:7:head:${"b".repeat(40)}` as const,
      line: 50,
      status: "persistent" as const,
      updatedAt: "2026-09-02T13:00:00.000Z",
    };

    await ledger.savePrFindings(prKey, [persistentFinding]);
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

    await ledger.savePrFindings(prKey, [resolvedFinding]);
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
    await ledger.savePrFindings(prKey, [dismissedFinding]);
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
      headSha: "a".repeat(40),
      isDegraded: true,
      scopeStatus: "partial_by_failure",
      shardsAnalyzed: 1,
      totalShards: 2,
    });
    await ledger.savePrFindings(prKey, [
      {
        confidence: 0.62,
        diagnostic: "A persisted finding with enough detail.",
        filePath: "src/example.ts",
        fingerprint,
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
    ]);

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
    const cleanupRunId = `github:42:pr:999:head:${"c".repeat(40)}` as const;
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

  it("persists and loads CI evidence per PR key and head sha", async () => {
    const testPrKey = "github:42:pr:88" as const;
    const ledger = env.REVIEW_LEDGERS.getByName(testPrKey);
    const testHeadSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    const initial = await ledger.loadCiEvidence(testPrKey, testHeadSha);
    expect(initial).toBeUndefined();

    await ledger.saveCiEvidence(testPrKey, testHeadSha, {
      markdown: "### 🧪 CI Test Evidence\nCoverage: 95%",
      workflowRunId: 12345,
    });

    const loaded = await ledger.loadCiEvidence(testPrKey, testHeadSha);
    expect(loaded).toBeDefined();
    expect(loaded?.markdown).toBe("### 🧪 CI Test Evidence\nCoverage: 95%");
    expect(loaded?.workflowRunId).toBe(12345);
  });

  it("persists and loads run telemetry accurately", async () => {
    const testPrKey = "github:42:pr:99" as const;
    const ledger = env.REVIEW_LEDGERS.getByName(testPrKey);
    const telemetryRunId = "test-run-telemetry-1";

    const initial = await ledger.loadRunTelemetry(telemetryRunId);
    expect(initial).toBeUndefined();

    const telemetry = {
      cost: {
        currency: "USD" as const,
        estimatedCostMicroUsd: 15000,
        estimatedCostUsd: 0.015,
        pricingModel: "deepseek-chat",
      },
      createdAt: new Date().toISOString(),
      durationMs: 12000,
      effectivePolicyDigest: "c".repeat(64),
      headSha: "b".repeat(40),
      isDegraded: false,
      policySource: ".github/holon.yml" as const,
      prKey: testPrKey,
      queueWaitMs: 400,
      runId: telemetryRunId,
      scopeStatus: "complete" as const,
      shardsCount: 2,
      stepTimings: [
        {
          attempt: 1,
          durationMs: 3000,
          status: "success" as const,
          stepName: "prepare_repository",
        },
      ],
      sourceDigest: "d".repeat(64),
      terminalState: "completed" as const,
      tokens: {
        inputTokens: 3000,
        outputTokens: 600,
        reasoningTokens: 100,
        totalTokens: 3700,
      },
      toolCallsCount: 5,
      verdict: "APPROVE" as const,
    };

    await ledger.saveRunTelemetry(telemetry);

    const loaded = await ledger.loadRunTelemetry(telemetryRunId);
    expect(loaded).toEqual(telemetry);
  });

  it("records projection tasks idempotently and transitions them", async () => {
    const testPrKey = "github:42:pr:7" as const;
    const ledger = env.REVIEW_LEDGERS.getByName(testPrKey);
    const testRunId = `github:42:pr:7:head:${"c".repeat(40)}` as RunId;

    const event = await buildAdminProjectionEventV1({
      headSha: "c".repeat(40),
      prKey: testPrKey,
      projectedFrom: "workflow",
      projectionRequestedAt: "2026-08-29T12:00:15.000Z",
      pullRequestNumber: 7,
      recordVersion: 1,
      repository: { id: 42, name: "api", owner: "acme" },
      reviewPhaseReached: "publishing",
      runId: testRunId,
      schemaVersion: 1,
      scopeStatus: "complete",
      telemetry: {
        estimatedCostMicroUsd: 1500,
        executionDurationMs: 12000,
        inputTokens: 3000,
        isDegraded: false,
        outputTokens: 600,
        pricingModel: "deepseek-chat",
        reasoningTokens: 100,
        reviewAdmissionQueueWaitMs: 400,
        shardsCount: 1,
        toolCallsCount: 2,
      },
      terminalState: "completed",
      timestamps: {
        analysisStartedAt: "2026-08-29T12:00:02.000Z",
        terminalAt: "2026-08-29T12:00:12.000Z",
        webhookReceivedAt: "2026-08-29T12:00:00.000Z",
        workflowStartedAt: "2026-08-29T12:00:01.000Z",
      },
      verdict: "APPROVE",
    });

    await ledger.recordProjectionTask(event);
    await ledger.recordProjectionTask(event);

    const task = await ledger.getProjectionTask(testRunId);
    expect(task).toBeDefined();
    expect(["pending", "processing", "completed"]).toContain(task?.state);

    await ledger.scheduleProjectionRetry(testRunId, "NetworkTimeout");
    const retriedTask = await ledger.getProjectionTask(testRunId);
    expect(retriedTask?.attempts).toBeGreaterThanOrEqual(1);
    expect(retriedTask?.last_error_kind).toBe("NetworkTimeout");

    await ledger.markProjectionTaskCompleted(testRunId);
    const completedTask = await ledger.getProjectionTask(testRunId);
    expect(completedTask?.state).toBe("completed");
    expect(completedTask?.completed_at).toBeDefined();
  });

  it("marks projection task as exhausted after 20 attempts", async () => {
    const testPrKey = "github:42:pr:7" as const;
    const ledger = env.REVIEW_LEDGERS.getByName(testPrKey);
    const testRunId = `github:42:pr:7:head:${"d".repeat(40)}` as RunId;

    const event = await buildAdminProjectionEventV1({
      headSha: "d".repeat(40),
      prKey: testPrKey,
      projectedFrom: "workflow",
      projectionRequestedAt: "2026-08-29T12:00:15.000Z",
      pullRequestNumber: 7,
      recordVersion: 1,
      repository: { id: 42, name: "api", owner: "acme" },
      reviewPhaseReached: "publishing",
      runId: testRunId,
      schemaVersion: 1,
      scopeStatus: "complete",
      telemetry: {
        estimatedCostMicroUsd: 1500,
        executionDurationMs: 12000,
        inputTokens: 3000,
        isDegraded: false,
        outputTokens: 600,
        pricingModel: "deepseek-chat",
        reasoningTokens: 100,
        reviewAdmissionQueueWaitMs: 400,
        shardsCount: 1,
        toolCallsCount: 2,
      },
      terminalState: "completed",
      timestamps: {
        analysisStartedAt: "2026-08-29T12:00:02.000Z",
        terminalAt: "2026-08-29T12:00:12.000Z",
        webhookReceivedAt: "2026-08-29T12:00:00.000Z",
        workflowStartedAt: "2026-08-29T12:00:01.000Z",
      },
      verdict: "APPROVE",
    });

    await ledger.recordProjectionTask(event);

    for (let i = 0; i < 20; i++) {
      await ledger.scheduleProjectionRetry(testRunId, "Failure");
    }

    const task = await ledger.getProjectionTask(testRunId);
    expect(task?.state).toBe("exhausted");
    expect(task?.attempts).toBe(20);
  });

  it("prioritizes cleanup over projection in alarm", async () => {
    const testPrKey = "github:42:pr:701" as const;
    const ledger = env.REVIEW_LEDGERS.getByName(testPrKey);
    const testRunId = `github:42:pr:701:head:${"e".repeat(40)}` as RunId;

    const event = await buildAdminProjectionEventV1({
      headSha: "e".repeat(40),
      prKey: testPrKey,
      projectedFrom: "workflow",
      projectionRequestedAt: "2026-08-29T12:00:15.000Z",
      pullRequestNumber: 701,
      recordVersion: 1,
      repository: { id: 42, name: "api", owner: "acme" },
      reviewPhaseReached: "publishing",
      runId: testRunId,
      schemaVersion: 1,
      scopeStatus: "complete",
      telemetry: {
        estimatedCostMicroUsd: 1500,
        executionDurationMs: 12000,
        inputTokens: 3000,
        isDegraded: false,
        outputTokens: 600,
        pricingModel: "deepseek-chat",
        reasoningTokens: 100,
        reviewAdmissionQueueWaitMs: 400,
        shardsCount: 1,
        toolCallsCount: 2,
      },
      terminalState: "completed",
      timestamps: {
        analysisStartedAt: "2026-08-29T12:00:02.000Z",
        terminalAt: "2026-08-29T12:00:12.000Z",
        webhookReceivedAt: "2026-08-29T12:00:00.000Z",
        workflowStartedAt: "2026-08-29T12:00:01.000Z",
      },
      verdict: "APPROVE",
    });

    await ledger.recordProjectionTask(event);
    await ledger.markTerminalAndRequestCleanup(
      testRunId,
      "2026-08-29T12:00:10.000Z",
      true,
    );

    await runDurableObjectAlarm(ledger);
    const cleanup = await ledger.cleanupState(testRunId);
    expect(cleanup?.state).toBe("completed");

    await runDurableObjectAlarm(ledger);
    const proj = await ledger.getProjectionTask(testRunId);
    expect(proj?.state).toMatch(/^(completed|pending|processing)$/);
  });

  it("sanitizes diagnostic in getSanitizedAdminRunDetailV2", async () => {
    const testPrKey = "github:42:pr:7" as const;
    const ledger = env.REVIEW_LEDGERS.getByName(testPrKey);
    const testRunId = `github:42:pr:7:head:${"f".repeat(40)}` as RunId;

    const telemetry = {
      cost: {
        currency: "USD" as const,
        estimatedCostMicroUsd: 1500,
        estimatedCostUsd: 0.0015,
        pricingModel: "deepseek-chat",
      },
      createdAt: new Date().toISOString(),
      durationMs: 10000,
      headSha: "f".repeat(40),
      isDegraded: false,
      prKey: testPrKey,
      queueWaitMs: 200,
      runId: testRunId,
      scopeStatus: "complete" as const,
      shardsCount: 1,
      stepTimings: [],
      terminalState: "completed" as const,
      tokens: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 },
      toolCallsCount: 1,
      verdict: "COMMENT" as const,
    };
    await ledger.saveRunTelemetry(telemetry);

    await ledger.savePrFindings(testPrKey, [
      {
        diagnostic:
          "\u001b[31mError: \u001b[0mBearer ghp_secret1234567890abcdef1234567890 " +
          "界".repeat(1500),
        filePath: "src/api.ts",
        fingerprint:
          "fp:1111111111111111111111111111111111111111111111111111111111111111",
        firstSeenHeadSha: "f".repeat(40),
        firstSeenRunId: testRunId,
        lastSeenHeadSha: "f".repeat(40),
        lastSeenRunId: testRunId,
        line: 42,
        prKey: testPrKey,
        severity: "high" as const,
        status: "new" as const,
        updatedAt: new Date().toISOString(),
      },
    ]);

    const detail = await ledger.getSanitizedAdminRunDetailV2(testRunId);
    expect(detail).not.toBeNull();
    expect(detail?.run.runId).toBe(testRunId);
    expect(detail?.currentFindings).toHaveLength(1);
    const firstFinding = detail?.currentFindings[0];
    expect(firstFinding?.diagnostic).not.toContain("\u001b");
    expect(firstFinding?.diagnostic).not.toContain("ghp_secret");
    expect(firstFinding?.diagnostic).toContain("界".repeat(1500));
  });

  it("returns null in getSanitizedAdminRunDetailV2 when run telemetry does not exist", async () => {
    const testPrKey = "github:42:pr:7" as const;
    const ledger = env.REVIEW_LEDGERS.getByName(testPrKey);
    const missingRunId = `github:42:pr:7:head:${"0".repeat(40)}` as RunId;

    const detail = await ledger.getSanitizedAdminRunDetailV2(missingRunId);
    expect(detail).toBeNull();
  });

  it("loads and exposes structuredCi in getSanitizedAdminRunDetailV2 and handles corrupted JSON safely", async () => {
    const testPrKey = "github:42:pr:101" as const;
    const ledger = env.REVIEW_LEDGERS.getByName(testPrKey);
    const headSha1 = "1".repeat(40);
    const runId1 = `github:42:pr:101:head:${headSha1}` as RunId;

    await ledger.saveCiEvidence(testPrKey, headSha1, {
      markdown: "CI run completed",
      workflowRunId: 1001,
      structuredCi: {
        durationMs: 12000,
        failed: 1,
        passed: 10,
        skipped: 0,
        status: "available",
        total: 11,
        workflowName: "CI Workflow",
      },
    });

    await ledger.saveRunTelemetry({
      cost: {
        currency: "USD",
        estimatedCostMicroUsd: 100,
        estimatedCostUsd: 0.0001,
        pricingModel: "deepseek-chat",
      },
      createdAt: new Date().toISOString(),
      durationMs: 3000,
      headSha: headSha1,
      isDegraded: false,
      prKey: testPrKey,
      queueWaitMs: 50,
      runId: runId1,
      scopeStatus: "complete",
      shardsCount: 1,
      stepTimings: [],
      terminalState: "completed",
      tokens: { inputTokens: 400, outputTokens: 50, totalTokens: 450 },
      toolCallsCount: 0,
      verdict: "APPROVE",
    });

    const detail = await ledger.getSanitizedAdminRunDetailV2(runId1);
    expect(detail?.structuredCi?.status).toBe("available");
    expect(detail?.structuredCi?.failed).toBe(1);

    await runInDurableObject(ledger, async (instance) => {
      const internal = instance as unknown as LedgerTestInternal;
      internal.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO ci_evidences (
           pr_key, head_sha, markdown_content, workflow_run_id, structured_ci_json, created_at
         ) VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
        testPrKey,
        "2".repeat(40),
        "corrupted evidence",
        1002,
        "{invalid-json",
      );
      const loaded = await instance.loadCiEvidence(testPrKey, "2".repeat(40));
      expect(loaded?.structuredCi).toBeNull();
    });
  });

  it("handles retry and exhaustion in processProjection when queue fails", async () => {
    const testPrKey = "github:42:pr:102" as const;
    const ledger = env.REVIEW_LEDGERS.getByName(testPrKey);
    const headSha3 = "3".repeat(40);
    const runId3 = `github:42:pr:102:head:${headSha3}` as RunId;

    await runInDurableObject(ledger, async (instance) => {
      const internal = instance as unknown as LedgerTestInternal;
      const failingQueue = {
        send: () => Promise.reject(new Error("Simulated queue down")),
      } as unknown as Queue<unknown>;
      internal.env = {
        ...internal.env,
        ADMIN_PROJECTION_QUEUE: failingQueue,
      };

      const event = await buildAdminProjectionEventV1({
        headSha: headSha3,
        prKey: testPrKey,
        projectedFrom: "workflow",
        projectionRequestedAt: new Date().toISOString(),
        pullRequestNumber: 102,
        recordVersion: 1,
        repository: { id: 42, name: "api", owner: "acme" },
        reviewPhaseReached: "publishing",
        runId: runId3,
        schemaVersion: 1,
        scopeStatus: "complete",
        telemetry: {
          estimatedCostMicroUsd: 100,
          executionDurationMs: 1000,
          inputTokens: 100,
          isDegraded: false,
          outputTokens: 10,
          pricingModel: "deepseek-chat",
          reasoningTokens: null,
          reviewAdmissionQueueWaitMs: 50,
          shardsCount: 1,
          toolCallsCount: 0,
        },
        terminalState: "completed",
        timestamps: {
          analysisStartedAt: null,
          terminalAt: "2026-08-29T12:00:10.000Z",
          webhookReceivedAt: "2026-08-29T12:00:00.000Z",
          workflowStartedAt: "2026-08-29T12:00:02.000Z",
        },
        verdict: "APPROVE",
      });

      internal.ctx.storage.sql.exec(
        `INSERT INTO projection_tasks (
           run_id, event_id, payload_json, payload_hash, state, attempts, requested_at, next_attempt_at
         ) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`,
        event.payload.runId,
        event.eventId,
        JSON.stringify(event),
        event.payloadHash,
        event.payload.projectionRequestedAt,
        new Date(0).toISOString(),
      );

      const task = await instance.getProjectionTask(runId3);
      expect(task).toBeDefined();

      if (task) {
        await internal.processDueProjection(new Date().toISOString());
      }

      const taskAfterOneFailure = await instance.getProjectionTask(runId3);
      expect(taskAfterOneFailure?.state).toBe("pending");
      expect(taskAfterOneFailure?.attempts).toBe(1);
      expect(taskAfterOneFailure?.last_error_kind).toContain("Error");
      expect(Date.parse(taskAfterOneFailure!.next_attempt_at)).toBeGreaterThan(
        Date.now() - 1000,
      );

      // Set attempts to 19 and reset next_attempt to 0 to simulate 20th failure reaching exhaustion
      internal.ctx.storage.sql.exec(
        "UPDATE projection_tasks SET attempts = 19, next_attempt_at = ? WHERE run_id = ?",
        new Date(0).toISOString(),
        runId3,
      );
      const taskFor20th = await instance.getProjectionTask(runId3);
      if (taskFor20th) {
        await internal.processDueProjection(new Date().toISOString());
      }

      const exhaustedTask = await instance.getProjectionTask(runId3);
      expect(exhaustedTask?.state).toBe("exhausted");
      expect(exhaustedTask?.attempts).toBe(20);
    });
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

describe("Migration 12 and step executions telemetry", () => {
  const v12PrKey = "github:42:pr:99" as const;
  const v12RunId = `github:42:pr:99:head:${"e".repeat(40)}` as RunId;
  const v12Run: ReviewRun = {
    attempt: 0,
    createdAt: "2026-09-04T12:00:00.000Z",
    id: v12RunId,
    prKey: v12PrKey,
    state: "queued",
  };

  it("records step attempt start, failure with retry, and completion without status regression", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName(v12PrKey);
    await ledger.claimRun(v12Run, "workflow-v12");
    const getSteps = async (id: string): Promise<StepExecutionNode[]> => {
      const stub = ledger as unknown as {
        getStepExecutions(id: string): Promise<StepExecutionNode[]>;
      };
      return await stub.getStepExecutions(id);
    };

    // 1. Attempt 1 start
    await ledger.recordStepAttemptStart(
      v12RunId,
      "analyze-review",
      "analysis",
      1,
      "2026-09-04T12:00:01.000Z",
      { modelRoute: "deepseek-chat", toolsBudget: 10 },
    );

    let steps = await getSteps(v12RunId);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.stepName).toBe("analyze-review");
    expect(steps[0]!.phase).toBe("analysis");
    expect(steps[0]!.status).toBe("running");
    expect(steps[0]!.attemptsCount).toBe(1);
    expect(steps[0]!.attempts).toHaveLength(1);
    expect(steps[0]!.attempts[0]!.status).toBe("running");

    // 2. Attempt 1 fails
    await ledger.recordStepAttemptFailure(
      v12RunId,
      "analyze-review",
      1,
      "2026-09-04T12:00:01.500Z",
      500,
      "TransientTimeoutError",
    );

    steps = await getSteps(v12RunId);
    expect(steps[0]!.status).toBe("failed");
    expect(steps[0]!.totalDurationMs).toBe(500);
    expect(steps[0]!.errorCode).toBe("TransientTimeoutError");
    expect(steps[0]!.attempts[0]!.status).toBe("failed");
    expect(steps[0]!.attempts[0]!.durationMs).toBe(500);

    // 3. Attempt 2 retries
    await ledger.recordStepAttemptStart(
      v12RunId,
      "analyze-review",
      "analysis",
      2,
      "2026-09-04T12:00:02.500Z",
      null,
      1000,
    );

    steps = await getSteps(v12RunId);
    expect(steps[0]!.status).toBe("running");
    expect(steps[0]!.attemptsCount).toBe(2);
    expect(steps[0]!.attempts).toHaveLength(2);
    expect(steps[0]!.attempts[1]!.attempt).toBe(2);
    expect(steps[0]!.attempts[1]!.waitBeforeRetryMs).toBe(1000);

    // 4. Attempt 2 completes successfully
    await ledger.recordStepAttemptComplete(
      v12RunId,
      "analyze-review",
      2,
      "2026-09-04T12:00:04.000Z",
      1500,
      { findingsCount: 1, summary: "Review completed." },
    );

    steps = await getSteps(v12RunId);
    expect(steps[0]!.status).toBe("completed");
    expect(steps[0]!.totalDurationMs).toBe(2000); // 500 + 1500
    expect(steps[0]!.sanitizedOutput).toEqual({
      findingsCount: 1,
      summary: "Review completed.",
    });
    expect(steps[0]!.attempts[1]!.status).toBe("completed");
    expect(steps[0]!.attempts[1]!.durationMs).toBe(1500);

    // 5. Calling recordStepAttemptStart on already completed step does NOT regress status to running
    await ledger.recordStepAttemptStart(
      v12RunId,
      "analyze-review",
      "analysis",
      2,
      "2026-09-04T12:00:05.000Z",
    );
    steps = await getSteps(v12RunId);
    expect(steps[0]!.status).toBe("completed");

    // 6. Deterministic sorting with stepOrder even when startedAt is identical
    await ledger.recordStepAttemptStart(
      v12RunId,
      "second-step",
      "preparation",
      1,
      "2026-09-04T12:00:00.000Z",
      null,
      null,
      2,
    );
    await ledger.recordStepAttemptStart(
      v12RunId,
      "first-step",
      "admission",
      1,
      "2026-09-04T12:00:00.000Z",
      null,
      null,
      1,
    );
    steps = await getSteps(v12RunId);
    expect(steps[0]!.stepName).toBe("analyze-review"); // step_order 0
    expect(steps[1]!.stepName).toBe("first-step"); // step_order 1
    expect(steps[2]!.stepName).toBe("second-step"); // step_order 2

    // 7. Defensive handling when payload is rejected (never throws in DO transaction)
    await ledger.recordStepAttemptStart(
      v12RunId,
      "third-step",
      "publication",
      1,
      "2026-09-04T12:00:10.000Z",
      { Authorization: "Bearer secret-token-leak" }, // forbidden key
      null,
      3,
    );
    steps = await getSteps(v12RunId);
    const thirdStep = steps.find((s) => s.stepName === "third-step");
    expect(thirdStep).toBeDefined();
    expect(thirdStep?.sanitizedInput).toEqual({
      sanitized: false,
      redactedReason: "payload_rejected",
    });
  });

  it("getSanitizedAdminRunDetailV3 returns detail for in-progress run and historical vs current findings", async () => {
    const prKey = "github:42:pr:120" as const;
    const ledger = env.REVIEW_LEDGERS.getByName(prKey);
    const runId1 = `github:42:pr:120:head:${"1".repeat(40)}` as RunId;
    const runId2 = `github:42:pr:120:head:${"2".repeat(40)}` as RunId;

    // Run 1: completed
    await ledger.claimRun(
      {
        attempt: 0,
        createdAt: "2026-09-04T10:00:00.000Z",
        id: runId1,
        prKey,
        state: "queued",
      },
      "workflow-1",
    );
    await ledger.transition(
      runId1,
      "queued",
      "running",
      "2026-09-04T10:00:01.000Z",
      "op-r1-start",
    );
    await ledger.transition(
      runId1,
      "running",
      "publishing",
      "2026-09-04T10:00:04.000Z",
      "op-r1-pub",
    );
    await ledger.transition(
      runId1,
      "publishing",
      "completed",
      "2026-09-04T10:00:05.000Z",
      "op-r1-done",
    );

    // Add findings: one produced by run 1, one updated later by run 2
    await ledger.savePrFindings(prKey, [
      {
        diagnostic: "Bug in old code",
        filePath: "src/old.ts",
        fingerprint: `fp:${"1".repeat(64)}`,
        firstSeenHeadSha: "1".repeat(40),
        firstSeenRunId: runId1,
        lastSeenHeadSha: "1".repeat(40),
        lastSeenRunId: runId1,
        line: 10,
        prKey,
        severity: "medium",
        status: "resolved",
        updatedAt: "2026-09-04T10:00:05.000Z",
      },
      {
        diagnostic: "Bug introduced in new code",
        filePath: "src/new.ts",
        fingerprint: `fp:${"2".repeat(64)}`,
        firstSeenHeadSha: "2".repeat(40),
        firstSeenRunId: runId2,
        lastSeenHeadSha: "2".repeat(40),
        lastSeenRunId: runId2,
        line: 20,
        prKey,
        severity: "high",
        status: "new",
        updatedAt: "2026-09-04T11:00:00.000Z",
      },
    ]);

    // Record step execution for run 1
    await ledger.recordStepAttemptStart(
      runId1,
      "prepare-repository",
      "preparation",
      1,
      "2026-09-04T10:00:02.000Z",
    );
    await ledger.recordStepAttemptComplete(
      runId1,
      "prepare-repository",
      1,
      "2026-09-04T10:00:03.000Z",
      1000,
    );

    const detail1 = await ledger.getSanitizedAdminRunDetailV3(runId1);
    expect(detail1).not.toBeNull();
    expect(detail1?.run.runId).toBe(runId1);
    expect(detail1?.run.runState).toBe("completed");
    expect(detail1?.currentFindings).toHaveLength(2);
    // Historical findings for run 1 should only contain the finding from run 1
    expect(detail1?.historicalRunFindings).toHaveLength(1);
    expect(detail1?.historicalRunFindings[0]!.filePath).toBe("src/old.ts");
    expect(detail1?.stepExecutions).toHaveLength(1);
    expect(detail1?.stepExecutions[0]!.stepName).toBe("prepare-repository");

    // Run 2: currently running
    await ledger.claimRun(
      {
        attempt: 0,
        createdAt: "2026-09-04T11:00:00.000Z",
        id: runId2,
        prKey,
        state: "queued",
      },
      "workflow-2",
    );
    await ledger.transition(
      runId2,
      "queued",
      "running",
      "2026-09-04T11:00:01.000Z",
      "op-r2-start",
    );

    const detail2 = await ledger.getSanitizedAdminRunDetailV3(runId2);
    expect(detail2).not.toBeNull();
    expect(detail2?.run.runId).toBe(runId2);
    expect(detail2?.run.runState).toBe("running");
    expect(detail2?.run.terminalState).toBeNull();
    expect(detail2?.historicalRunFindings).toHaveLength(1);
    expect(detail2?.historicalRunFindings[0]!.filePath).toBe("src/new.ts");

    // Non-existent run returns null
    const missing = await ledger.getSanitizedAdminRunDetailV3(
      `github:42:pr:120:head:${"9".repeat(40)}`,
    );
    expect(missing).toBeNull();
  });
});
