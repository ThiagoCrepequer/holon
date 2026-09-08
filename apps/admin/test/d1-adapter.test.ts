import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { D1AdminStorage } from "../workers/d1-adapter.js";
import {
  createSampleProjectionEvent,
  setupTestDatabase,
  TEST_KEYRING,
} from "./helpers.js";

describe("D1AdminStorage", () => {
  let storage: D1AdminStorage;

  beforeEach(async () => {
    await setupTestDatabase(env.DB);
    storage = new D1AdminStorage(env.DB);
  });

  describe("insertProjection", () => {
    it("inserts a new valid projection and updates metadata", async () => {
      const event = await createSampleProjectionEvent();
      const result = await storage.insertProjection(event, 1772582450000);

      expect(result).toEqual({ status: "inserted" });

      const row = await storage.getRunById(event.payload.runId);
      expect(row).not.toBeNull();
      expect(row?.run_id).toBe(event.payload.runId);
      expect(row?.payload_hash).toBe(event.payloadHash);
      expect(row?.source_event_id).toBe(event.eventId);
      expect(row?.is_degraded).toBe(0);

      const meta = await env.DB.prepare(
        "SELECT * FROM admin_metadata WHERE key = 'last_projection_received_at'",
      ).first<{ value: string }>();
      expect(meta?.value).toBeDefined();
    });

    it("detects exact duplicate projections idempotently", async () => {
      const event = await createSampleProjectionEvent();
      const first = await storage.insertProjection(event, 1772582450000);
      expect(first).toEqual({ status: "inserted" });

      const second = await storage.insertProjection(event, 1772582451000);
      expect(second).toEqual({ status: "duplicate" });
    });

    it("detects divergent payload conflict for the same run_id", async () => {
      const event1 = await createSampleProjectionEvent(
        {
          verdict: "APPROVE",
        },
        "evt-1",
      );
      await storage.insertProjection(event1, 1772582450000);

      // Event 2 has same runId but different payload (verdict changed)
      const event2 = await createSampleProjectionEvent(
        {
          verdict: "REQUEST_CHANGES",
        },
        "evt-2",
      );
      const result = await storage.insertProjection(event2, 1772582451000);

      expect(result).toEqual({ status: "conflict" });
    });

    it("detects source_event_id collision across different run_ids", async () => {
      const event1 = await createSampleProjectionEvent(
        {
          headSha: "1111111111111111111111111111111111111111",
          runId:
            "github:101:pr:1:head:1111111111111111111111111111111111111111",
        },
        "evt-shared-1",
      );
      await storage.insertProjection(event1, 1772582450000);

      const event2 = await createSampleProjectionEvent(
        {
          prNumber: 2,
          prKey: "github:101:pr:2",
          headSha: "2222222222222222222222222222222222222222",
          runId:
            "github:101:pr:2:head:2222222222222222222222222222222222222222",
        },
        "evt-shared-1",
      );

      const result = await storage.insertProjection(event2, 1772582451000);
      expect(result).toEqual({ status: "event_id_collision" });
    });
  });

  describe("quarantine", () => {
    it("persists quarantine records with hashed identifiers and error code", async () => {
      await storage.quarantine({
        observedEventId: "evt-bad-1",
        observedRunId: "run-bad-1",
        payloadBytes: 128,
        computedPayloadHash: "a".repeat(64),
        errorCode: "INVALID_EVENT_SCHEMA",
        nowEpochMs: 1772582450000,
      });

      const items = await storage.getQuarantined(10);
      expect(items.length).toBe(1);
      expect(items[0]?.error_code).toBe("INVALID_EVENT_SCHEMA");
      expect(items[0]?.payload_bytes).toBe(128);
      expect(items[0]?.observed_event_id_hash).toBeDefined();
      expect(items[0]?.observed_run_id_hash).toBeDefined();
    });
  });

  describe("listRuns & pagination", () => {
    it("paginates runs with signed cursor and handles structured filters", async () => {
      const now = 1772582400000;
      // Insert 21 runs with decreasing terminal timestamps
      for (let i = 1; i <= 21; i++) {
        const sha = String(i).padStart(40, "0");
        const event = await createSampleProjectionEvent({
          headSha: sha,
          prNumber: i,
          terminalAtEpochMs: now - i * 1000,
          verdict: i === 1 ? "APPROVE" : "REQUEST_CHANGES",
        });
        await storage.insertProjection(event, now);
      }

      // Page 1 with pageSize 20
      const page1 = await storage.listRuns(
        { order: "desc", pageSize: 20 },
        TEST_KEYRING,
        now,
      );
      expect(page1.runs.length).toBe(20);
      expect(page1.runs[0]?.pr_number).toBe(1);
      expect(page1.runs[19]?.pr_number).toBe(20);
      expect(page1.nextCursor).not.toBeNull();

      // Page 2 using nextCursor
      const page2 = await storage.listRuns(
        { cursor: page1.nextCursor!, order: "desc", pageSize: 20 },
        TEST_KEYRING,
        now,
      );
      expect(page2.runs.length).toBe(1);
      expect(page2.runs[0]?.pr_number).toBe(21);
      expect(page2.nextCursor).toBeNull();
    });

    it("honors ascending keyset order", async () => {
      const now = 1772582400000;
      for (let i = 1; i <= 21; i++) {
        const sha = i.toString(16).padStart(40, "0");
        await storage.insertProjection(
          await createSampleProjectionEvent({
            headSha: sha,
            prNumber: i,
            terminalAtEpochMs: now - i * 1000,
          }),
          now,
        );
      }
      const first = await storage.listRuns(
        { order: "asc", pageSize: 20 },
        TEST_KEYRING,
        now,
      );
      expect(first.runs[0]?.pr_number).toBe(21);
      const second = await storage.listRuns(
        { order: "asc", pageSize: 20, cursor: first.nextCursor! },
        TEST_KEYRING,
        now,
      );
      expect(second.runs[0]?.pr_number).toBe(1);
    });

    it("binds pagination cursors to the structured search query", async () => {
      const now = 1772582400000;
      for (let i = 1; i <= 21; i++) {
        await storage.insertProjection(
          await createSampleProjectionEvent({
            headSha: i.toString(16).padStart(40, "0"),
            prNumber: i,
          }),
          now,
        );
      }
      const page = await storage.listRuns({ pageSize: 20 }, TEST_KEYRING, now);
      await expect(
        storage.listRuns(
          {
            cursor: page.nextCursor!,
            pageSize: 20,
            searchQuery: "test-owner/test-repo#1",
          },
          TEST_KEYRING,
          now,
        ),
      ).rejects.toThrow("Cursor filter mismatch");
    });

    it("filters runs by structured search query: repo#pr, head_sha, run_id", async () => {
      const now = 1772582400000;
      const sha = "abcdef1234567890abcdef1234567890abcdef12";
      const event = await createSampleProjectionEvent(
        {
          headSha: sha,
          prKey: "github:999:pr:42",
          prNumber: 42,
          repositoryName: "repo-xyz",
          repositoryOwner: "owner-abc",
          runId: `github:999:pr:42:head:${sha}`,
        },
        "evt-search",
      );
      await storage.insertProjection(event, now);

      // Search by owner/name#PR
      const res1 = await storage.listRuns(
        { order: "desc", pageSize: 50, searchQuery: "owner-abc/repo-xyz#42" },
        TEST_KEYRING,
        now,
      );
      expect(res1.runs.length).toBe(1);
      expect(res1.runs[0]?.run_id).toBe(event.payload.runId);

      // Search by head_sha
      const res2 = await storage.listRuns(
        { searchQuery: sha, pageSize: 50, order: "desc" },
        TEST_KEYRING,
        now,
      );
      expect(res2.runs.length).toBe(1);

      // Search by run_id
      const res3 = await storage.listRuns(
        {
          searchQuery: `github:999:pr:42:head:${sha}`,
          pageSize: 50,
          order: "desc",
        },
        TEST_KEYRING,
        now,
      );
      expect(res3.runs.length).toBe(1);

      // Search with invalid/unsupported format returns empty
      const res4 = await storage.listRuns(
        { searchQuery: "random text query", pageSize: 50, order: "desc" },
        TEST_KEYRING,
        now,
      );
      expect(res4.runs.length).toBe(0);
    });

    it("filters runs by period, repositoryId, terminalState, verdict", async () => {
      const now = 1772582400000;
      const event = await createSampleProjectionEvent(
        {
          repositoryId: 200,
          terminalState: "completed",
          verdict: "APPROVE",
          terminalAtEpochMs: now - 3600 * 1000,
          terminalAt: new Date(now - 3600 * 1000).toISOString(),
        },
        "evt-filter",
      );
      await storage.insertProjection(event, now);

      const res = await storage.listRuns(
        {
          period: "24h",
          repositoryId: 200,
          terminalState: "completed",
          verdict: "APPROVE",
          pageSize: 50,
          order: "desc",
        },
        TEST_KEYRING,
        now,
      );
      expect(res.runs.length).toBe(1);

      const noMatch = await storage.listRuns(
        {
          period: "24h",
          repositoryId: 999,
          pageSize: 50,
          order: "desc",
        },
        TEST_KEYRING,
        now,
      );
      expect(noMatch.runs.length).toBe(0);
    });
  });

  describe("projection watermark", () => {
    it("returns cutover and latest projection timestamps", async () => {
      await env.DB.prepare(
        `INSERT INTO admin_metadata (key, value, updated_at_epoch_ms)
         VALUES ('projection_enabled_at', '2026-09-04T00:00:00.000Z', 1772668800000)`,
      ).run();
      await storage.insertProjection(
        await createSampleProjectionEvent(),
        1772582450000,
      );
      await expect(storage.getProjectionWatermark()).resolves.toEqual({
        enabledAt: "2026-09-04T00:00:00.000Z",
        lastReceivedAt: new Date(1772582450000).toISOString(),
      });
    });
  });

  describe("getSummaryMetrics", () => {
    it("aggregates totals, success rate, and verdict counts", async () => {
      const now = 1772582400000;
      const event1 = await createSampleProjectionEvent(
        {
          terminalState: "completed",
          verdict: "APPROVE",
          inputTokens: 1000,
          outputTokens: 500,
          reasoningTokens: 200,
          estimatedCostMicroUsd: 2000,
          executionDurationMs: 10000,
        },
        "evt-m1",
      );
      const sha2 = "b".repeat(40);
      const event2 = await createSampleProjectionEvent(
        {
          runId: `github:101:pr:2:head:${sha2}`,
          prKey: "github:101:pr:2",
          prNumber: 2,
          headSha: sha2,
          terminalState: "failed_terminal",
          verdict: null,
          inputTokens: 2000,
          outputTokens: 100,
          reasoningTokens: 0,
          estimatedCostMicroUsd: 1000,
          executionDurationMs: 20000,
        },
        "evt-m2",
      );

      await storage.insertProjection(event1, now);
      await storage.insertProjection(event2, now);

      const metrics = await storage.getSummaryMetrics("24h", now);
      expect(metrics.totalRuns).toBe(2);
      expect(metrics.completedRuns).toBe(1);
      expect(metrics.failedTerminalRuns).toBe(1);
      expect(metrics.successRatePercentage).toBe(50);
      expect(metrics.totalTokens).toBe(3800);
      expect(metrics.totalEstimatedCostMicroUsd).toBe(3000);
      expect(metrics.averageExecutionDurationMs).toBe(15000);
      expect(metrics.verdictDistribution.approve).toBe(1);
    });
  });

  describe("cleanupRetention", () => {
    it("deletes runs older than 180 days and quarantine older than 30 days", async () => {
      const now = 1772582400000;
      const ms181Days = 181 * 24 * 3600 * 1000;
      const ms31Days = 31 * 24 * 3600 * 1000;

      const shaOld = "1".repeat(40);
      const oldEvent = await createSampleProjectionEvent(
        {
          runId: `github:101:pr:99:head:${shaOld}`,
          prKey: "github:101:pr:99",
          prNumber: 99,
          headSha: shaOld,
          terminalAtEpochMs: now - ms181Days,
          terminalAt: new Date(now - ms181Days).toISOString(),
        },
        "evt-old",
      );
      await storage.insertProjection(oldEvent, now - ms181Days);

      const shaRecent = "2".repeat(40);
      const recentEvent = await createSampleProjectionEvent(
        {
          runId: `github:101:pr:100:head:${shaRecent}`,
          prKey: "github:101:pr:100",
          prNumber: 100,
          headSha: shaRecent,
          terminalAtEpochMs: now - 1000,
          terminalAt: new Date(now - 1000).toISOString(),
        },
        "evt-recent",
      );
      await storage.insertProjection(recentEvent, now);

      await storage.quarantine({
        observedEventId: "evt-q-old",
        payloadBytes: 10,
        computedPayloadHash: "c".repeat(64),
        errorCode: "INVALID_EVENT_SCHEMA",
        nowEpochMs: now - ms31Days,
      });

      await storage.quarantine({
        observedEventId: "evt-q-recent",
        payloadBytes: 10,
        computedPayloadHash: "d".repeat(64),
        errorCode: "INVALID_EVENT_SCHEMA",
        nowEpochMs: now - 1000,
      });

      const cleanup = await storage.cleanupRetention(now);
      expect(cleanup.deletedRunsCount).toBe(1);
      expect(cleanup.deletedQuarantineCount).toBe(1);

      expect(await storage.getRunById(oldEvent.payload.runId)).toBeNull();
      expect(
        await storage.getRunById(recentEvent.payload.runId),
      ).not.toBeNull();

      const remainingQuarantine = await storage.getQuarantined(10);
      expect(remainingQuarantine.length).toBe(1);
    });
  });

  describe("branch coverage edge cases", () => {
    it("handles period filters for 7d and 30d, empty search query, and null reasoning/scope", async () => {
      const now = 1772582400000;
      const sha = "3".repeat(40);
      const event = await createSampleProjectionEvent({
        runId: `github:101:pr:300:head:${sha}`,
        prKey: "github:101:pr:300",
        prNumber: 300,
        headSha: sha,
        isDegraded: true,
        reasoningTokens: null,
        scopeStatus: null,
        verdict: "COMMENT",
        terminalAtEpochMs: now - 3 * 24 * 3600 * 1000,
      });
      await storage.insertProjection(event, now);

      const sha4 = "4".repeat(40);
      const event4 = await createSampleProjectionEvent({
        runId: `github:101:pr:400:head:${sha4}`,
        prKey: "github:101:pr:400",
        prNumber: 400,
        headSha: sha4,
        verdict: "REQUEST_CHANGES",
        terminalAtEpochMs: now - 15 * 24 * 3600 * 1000,
      });
      await storage.insertProjection(event4, now);

      // Query 7d
      const res7d = await storage.listRuns(
        { period: "7d", searchQuery: "   ", pageSize: 50 },
        TEST_KEYRING,
        now,
      );
      expect(res7d.runs.length).toBe(1);
      expect(res7d.runs[0]?.is_degraded).toBe(1);
      expect(res7d.runs[0]?.reasoning_tokens).toBeNull();
      expect(res7d.runs[0]?.scope_status).toBeNull();
      expect(res7d.nextCursor).toBeNull();

      // Query 30d
      const res30d = await storage.listRuns(
        { period: "30d", pageSize: 50 },
        TEST_KEYRING,
        now,
      );
      expect(res30d.runs.length).toBe(2);

      // Summary metrics for 7d and 30d with COMMENT and REQUEST_CHANGES
      const metrics7d = await storage.getSummaryMetrics("7d", now);
      expect(metrics7d.verdictDistribution.comment).toBe(1);

      const metrics30d = await storage.getSummaryMetrics("30d", now);
      expect(metrics30d.verdictDistribution.requestChanges).toBe(1);
      expect(metrics30d.verdictDistribution.comment).toBe(1);
    });

    it("rethrows unexpected database errors during insertion", async () => {
      const failingDb = {
        prepare: () => {
          throw new Error("Disk I/O error");
        },
      } as unknown as D1Database;
      const badStorage = new D1AdminStorage(failingDb);
      const event = await createSampleProjectionEvent();
      await expect(badStorage.insertProjection(event)).rejects.toThrow(
        "Disk I/O error",
      );
    });

    it("covers default parameters for getQuarantined, getSummaryMetrics, cleanupRetention, and empty db summary", async () => {
      // Empty db summary metrics default
      const emptyMetrics = await storage.getSummaryMetrics();
      expect(emptyMetrics.totalRuns).toBe(0);
      expect(emptyMetrics.successRatePercentage).toBe(100);

      // Default limit in getQuarantined
      const qList = await storage.getQuarantined();
      expect(Array.isArray(qList)).toBe(true);

      // Default now in cleanupRetention
      const cleanup = await storage.cleanupRetention();
      expect(cleanup.deletedRunsCount).toBe(0);
    });
  });
});
