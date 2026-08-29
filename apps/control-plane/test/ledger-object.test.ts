import type {
  PublicationId,
  PublicationRecord,
  ReviewRun,
  RunId,
} from "@holon/domain";
import {
  createExecutionContext,
  reset,
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
      ledger.markRetryExhausted(runId, "2026-08-29T12:00:04.000Z"),
    ).resolves.toBe(true);
    await expect(
      ledger.markRetryExhausted(runId, "2026-08-29T12:00:05.000Z"),
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
