import type {
  PublicationId,
  PublicationRecord,
  ReviewRun,
  RunId,
} from "@holon/domain";
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

  it("does not let a delayed older delivery supersede the causally newer head", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    const newerId = `github:42:pr:7:head:${"b".repeat(40)}` as RunId;
    await ledger.claimRun(
      { ...run, createdAt: "2026-08-29T12:02:00.000Z", id: newerId },
      "workflow-newer",
      "2026-08-29T12:02:00.000Z",
    );
    await ledger.claimRun(run, "workflow-delayed", "2026-08-29T12:00:00.000Z");

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
    await runInDurableObject(ledger, (_object, state) => {
      expect(
        state.storage.sql
          .exec<{ version: number }>(
            "SELECT version FROM schema_migrations ORDER BY version",
          )
          .toArray(),
      ).toEqual([{ version: 1 }, { version: 2 }]);
      expect(
        state.storage.sql
          .exec<{ causal_version: string }>(
            "SELECT causal_version FROM runs WHERE id = ?",
            runId,
          )
          .one().causal_version,
      ).toBe(run.createdAt);
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
});
