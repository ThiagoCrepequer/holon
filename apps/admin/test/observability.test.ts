import { describe, expect, it, vi } from "vitest";

import { deriveOperationalNotices } from "../app/operational-status.js";
import type { AdminEnv } from "../workers/app.js";
import { queryAnalyticsTrend } from "../workers/observability/analytics-client.js";
import { queryQueueHealth } from "../workers/observability/queue-metrics-client.js";
import {
  type AdminReadRpcClient,
  checkReadiness,
} from "../workers/observability/readiness.js";
import { consoleObservabilityLogger } from "../workers/observability/safe-log.js";

describe("Observability clients and readiness probe", () => {
  describe("queryAnalyticsTrend", () => {
    it("returns unavailable when accountId or apiToken is missing", async () => {
      const logger = vi.fn();
      const res = await queryAnalyticsTrend("24h", { logger });
      expect(res.status).toBe("unavailable");
      if (res.status === "unavailable") {
        expect(res.reason).toBe("missing_configuration");
      }
      expect(logger).toHaveBeenCalledExactlyOnceWith({
        event: "holon.admin.integration_unavailable",
        integration: "analytics_engine",
        reason: "missing_configuration",
      });
    });

    it("validates a sampled, bucketed analytics response", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                bucket: "2026-09-04 12:00:00",
                p50_duration_ms: 1200,
                p95_duration_ms: 3500,
                sampled_count: 42,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const res = await queryAnalyticsTrend("24h", {
        accountId: "acc-123",
        apiToken: "tok-456",
        fetchFn: mockFetch,
      });

      expect(res.status).toBe("ok");
      if (res.status === "ok") {
        expect(res.data.p50DurationMs).toBe(1200);
        expect(res.data.p95DurationMs).toBe(3500);
        expect(res.data.sampledRunsCount).toBe(42);
        expect(res.data.window).toBe("24h");
        expect(res.data.points).toEqual([
          {
            bucket: "2026-09-04 12:00:00",
            p50DurationMs: 1200,
            p95DurationMs: 3500,
            sampledRunsCount: 42,
          },
        ]);
      }
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(init.body).toContain("quantileExactWeighted");
      expect(init.body).toContain("_sample_interval");
      expect(init.body).toContain("GROUP BY bucket");
    });

    it.each([
      ["24h", "INTERVAL '1' HOUR", "INTERVAL '24' HOUR"],
      ["7d", "INTERVAL '6' HOUR", "INTERVAL '168' HOUR"],
      ["30d", "INTERVAL '1' DAY", "INTERVAL '720' HOUR"],
    ] as const)(
      "uses Cloudflare-supported interval literals for the %s window",
      async (window, bucketInterval, lookbackInterval) => {
        const mockFetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );

        await queryAnalyticsTrend(window, {
          accountId: "acc-123",
          apiToken: "tok-456",
          fetchFn: mockFetch,
        });

        const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        if (typeof init.body !== "string") {
          throw new TypeError("Expected Analytics Engine query body to be SQL");
        }
        const sql = init.body;
        expect(sql).toContain(
          `toStartOfInterval(timestamp, ${bucketInterval}) AS bucket`,
        );
        expect(sql).toContain(`WHERE timestamp >= NOW() - ${lookbackInterval}`);
        expect(sql).not.toMatch(/INTERVAL '\d+ (?:HOUR|DAY)'/);
      },
    );

    it("handles response with empty data array or missing quantiles", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const res = await queryAnalyticsTrend("24h", {
        accountId: "acc-123",
        apiToken: "tok-456",
        fetchFn: mockFetch,
      });

      expect(res.status).toBe("ok");
      if (res.status === "ok") {
        expect(res.data.p50DurationMs).toBe(0);
        expect(res.data.p95DurationMs).toBe(0);
        expect(res.data.sampledRunsCount).toBe(0);
        expect(res.data.points).toEqual([]);
      }
    });

    it("handles upstream error gracefully without throwing", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(new Response("Server Error", { status: 500 }));
      const logger = vi.fn();

      const res = await queryAnalyticsTrend("7d", {
        accountId: "acc-123",
        apiToken: "tok-456",
        fetchFn: mockFetch,
        logger,
      });

      expect(res.status).toBe("unavailable");
      expect(logger).toHaveBeenCalledExactlyOnceWith({
        event: "holon.admin.integration_unavailable",
        integration: "analytics_engine",
        reason: "upstream_error",
        upstreamStatus: 500,
      });
      expect(JSON.stringify(logger.mock.calls)).not.toContain("tok-456");
      expect(JSON.stringify(logger.mock.calls)).not.toContain("Server Error");
    });

    it("handles fetch rejection or json parse error", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
      const logger = vi.fn();

      const res = await queryAnalyticsTrend("24h", {
        accountId: "acc-123",
        apiToken: "tok-456",
        fetchFn: mockFetch,
        logger,
      });

      expect(res.status).toBe("unavailable");
      if (res.status === "unavailable") {
        expect(res.reason).toBe("request_failed");
      }
      expect(logger).toHaveBeenCalledExactlyOnceWith({
        event: "holon.admin.integration_unavailable",
        integration: "analytics_engine",
        reason: "request_failed",
      });
      expect(JSON.stringify(logger.mock.calls)).not.toContain("network error");
    });

    it("rejects malformed or non-JSON upstream data", async () => {
      const malformed = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ sampled_count: "many" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      await expect(
        queryAnalyticsTrend("24h", {
          accountId: "acc-123",
          apiToken: "tok-456",
          fetchFn: malformed,
        }),
      ).resolves.toMatchObject({ status: "unavailable" });

      const html = vi.fn().mockResolvedValue(
        new Response("<html>oops</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );
      await expect(
        queryAnalyticsTrend("24h", {
          accountId: "acc-123",
          apiToken: "tok-456",
          fetchFn: html,
        }),
      ).resolves.toMatchObject({ status: "unavailable" });
    });
  });

  describe("queryQueueHealth", () => {
    it("returns unavailable when config is missing", async () => {
      const logger = vi.fn();
      const res = await queryQueueHealth({ logger });
      expect(res.status).toBe("unavailable");
      if (res.status === "unavailable") {
        expect(res.reason).toBe("missing_configuration");
      }
      expect(logger).toHaveBeenCalledExactlyOnceWith({
        event: "holon.admin.integration_unavailable",
        integration: "queue_metrics",
        reason: "missing_configuration",
      });
    });

    it("parses queue metrics and detects healthy state", async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("queue-main")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: true,
                result: {
                  backlog_count: 5,
                  oldest_message_timestamp_ms: 1_999_990_000,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              result: {
                backlog_count: 0,
                oldest_message_timestamp_ms: 0,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      });

      const res = await queryQueueHealth({
        accountId: "acc-1",
        apiToken: "tok-1",
        queueId: "queue-main",
        dlqId: "queue-dlq",
        fetchFn: mockFetch,
        nowEpochMs: () => 2_000_000_000,
      });

      expect(res.status).toBe("ok");
      if (res.status === "ok") {
        expect(res.data.backlogCount).toBe(5);
        expect(res.data.dlqCount).toBe(0);
        expect(res.data.isDegraded).toBe(false);
        expect(res.data.oldestMessageAgeSeconds).toBe(10);
      }
      expect(mockFetch.mock.calls[0]?.[0]).toContain("queue-main/metrics");
      expect(mockFetch.mock.calls[1]?.[0]).toContain("queue-dlq/metrics");
    });

    it("works without dlqId configured", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            result: {
              backlog_count: 3,
              oldest_message_timestamp_ms: 0,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const res = await queryQueueHealth({
        accountId: "acc-1",
        apiToken: "tok-1",
        queueId: "queue-main",
        fetchFn: mockFetch,
      });

      expect(res.status).toBe("ok");
      if (res.status === "ok") {
        expect(res.data.backlogCount).toBe(3);
        expect(res.data.dlqCount).toBe(0);
        expect(res.data.isDegraded).toBe(false);
      }
    });

    it("detects degraded state from oldest-message age", async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("queue-main")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: true,
                result: {
                  backlog_count: 1,
                  oldest_message_timestamp_ms: 1_999_000_000,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              result: {
                backlog_count: 3,
                oldest_message_timestamp_ms: 1_999_999_000,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      });

      const res = await queryQueueHealth({
        accountId: "acc-1",
        apiToken: "tok-1",
        queueId: "queue-main",
        dlqId: "queue-dlq",
        fetchFn: mockFetch,
        nowEpochMs: () => 2_000_000_000,
      });

      expect(res.status).toBe("ok");
      if (res.status === "ok") {
        expect(res.data.dlqCount).toBe(3);
        expect(res.data.isDegraded).toBe(true);
        expect(res.data.oldestMessageAgeSeconds).toBe(1000);
      }
    });

    it("handles upstream queue API failure", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(new Response("Queue not found", { status: 404 }));
      const logger = vi.fn();

      const res = await queryQueueHealth({
        accountId: "acc-1",
        apiToken: "tok-1",
        queueId: "queue-missing",
        fetchFn: mockFetch,
        logger,
      });

      expect(res.status).toBe("unavailable");
      if (res.status === "unavailable") {
        expect(res.reason).toBe("upstream_error");
      }
      expect(logger).toHaveBeenCalledExactlyOnceWith({
        event: "holon.admin.integration_unavailable",
        integration: "queue_metrics",
        reason: "upstream_error",
        upstreamStatus: 404,
      });
      expect(JSON.stringify(logger.mock.calls)).not.toContain("tok-1");
      expect(JSON.stringify(logger.mock.calls)).not.toContain(
        "Queue not found",
      );
    });

    it("handles fetch rejection or network error", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
      const logger = vi.fn();

      const res = await queryQueueHealth({
        accountId: "acc-1",
        apiToken: "tok-1",
        queueId: "queue-main",
        fetchFn: mockFetch,
        logger,
      });

      expect(res.status).toBe("unavailable");
      if (res.status === "unavailable") {
        expect(res.reason).toBe("request_failed");
      }
      expect(logger).toHaveBeenCalledExactlyOnceWith({
        event: "holon.admin.integration_unavailable",
        integration: "queue_metrics",
        reason: "request_failed",
      });
      expect(JSON.stringify(logger.mock.calls)).not.toContain("network error");
    });

    it("does not report a configured DLQ as empty when its metrics fail", async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          url.includes("queue-dlq")
            ? new Response("unavailable", { status: 503 })
            : new Response(
                JSON.stringify({
                  success: true,
                  result: {
                    backlog_count: 0,
                    oldest_message_timestamp_ms: 0,
                  },
                }),
                {
                  status: 200,
                  headers: { "content-type": "application/json" },
                },
              ),
        ),
      );
      await expect(
        queryQueueHealth({
          accountId: "acc-1",
          apiToken: "tok-1",
          queueId: "queue-main",
          dlqId: "queue-dlq",
          fetchFn: mockFetch,
        }),
      ).resolves.toMatchObject({ status: "unavailable" });
    });
  });

  describe("deriveOperationalNotices", () => {
    it("distinguishes unavailable integrations from an actual queue SLO breach", () => {
      expect(
        deriveOperationalNotices(
          { status: "unavailable", reason: "missing_configuration" },
          { status: "unavailable", reason: "missing_configuration" },
        ),
      ).toEqual([
        { service: "Analytics Engine", state: "unavailable" },
        { service: "Queue Pipeline", state: "unavailable" },
      ]);

      expect(
        deriveOperationalNotices(
          {
            status: "ok",
            data: {
              p50DurationMs: 0,
              p95DurationMs: 0,
              points: [],
              sampledRunsCount: 0,
              window: "24h",
            },
          },
          {
            status: "ok",
            data: {
              backlogCount: 1,
              dlqCount: 0,
              isDegraded: true,
              oldestMessageAgeSeconds: 301,
            },
          },
        ),
      ).toEqual([{ service: "Queue Pipeline", state: "degraded" }]);
    });
  });

  it("serializes the allowlisted integration event for Workers Logs", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const entry = {
      event: "holon.admin.integration_unavailable",
      integration: "queue_metrics",
      reason: "upstream_error",
      upstreamStatus: 503,
    } as const;

    try {
      consoleObservabilityLogger(entry);
      expect(warn).toHaveBeenCalledExactlyOnceWith(JSON.stringify(entry));
    } finally {
      warn.mockRestore();
    }
  });

  describe("checkReadiness", () => {
    it("reports healthy when D1 and RPC are healthy and telemetries pass", async () => {
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({ alive: 1 }),
        }),
      } as unknown as D1Database;

      const mockRpc: AdminReadRpcClient = {
        pingV1: vi.fn().mockResolvedValue({ schemaVersion: 1 }),
        getRunDetailV2: vi.fn().mockResolvedValue(null),
      };

      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("analytics_engine")) {
          return Promise.resolve(
            new Response(JSON.stringify({ data: [] }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              result: {
                backlog_count: 0,
                oldest_message_timestamp_ms: 0,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      });

      const env = {
        DB: mockDb,
        ADMIN_READ_API: mockRpc as unknown as Fetcher,
        CF_ACCOUNT_ID: "acc-1",
        CF_ANALYTICS_API_TOKEN: "tok-1",
        CF_QUEUES_READ_TOKEN: "tok-2",
        PROJECTION_QUEUE_ID: "queue-main",
        PROJECTION_DLQ_ID: "queue-dlq",
      } as unknown as AdminEnv;

      const report = await checkReadiness(env, mockFetch);
      expect(report.checks.d1).toBe("healthy");
      expect(report.checks.rpc).toBe("healthy");
      expect(report.checks.analyticsEngine).toBe("healthy");
      expect(report.checks.queueMetrics).toBe("healthy");
      expect(report.status).toBe("healthy");
    });

    it("reports partial when optional telemetries are unknown", async () => {
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({ alive: 1 }),
        }),
      } as unknown as D1Database;

      const mockRpc: AdminReadRpcClient = {
        pingV1: vi.fn().mockResolvedValue({ schemaVersion: 1 }),
        getRunDetailV2: vi.fn().mockResolvedValue(null),
      };

      const env = {
        DB: mockDb,
        ADMIN_READ_API: mockRpc as unknown as Fetcher,
      } as unknown as AdminEnv;

      const report = await checkReadiness(env);
      expect(report.checks.d1).toBe("healthy");
      expect(report.checks.rpc).toBe("healthy");
      expect(report.checks.analyticsEngine).toBe("unknown");
      expect(report.checks.queueMetrics).toBe("unknown");
      expect(report.status).toBe("partial");
    });

    it("reports degraded when D1 probe fails or DB missing", async () => {
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          first: vi.fn().mockRejectedValue(new Error("Database disconnected")),
        }),
      } as unknown as D1Database;

      const mockRpc: AdminReadRpcClient = {
        pingV1: vi.fn().mockResolvedValue({ schemaVersion: 1 }),
        getRunDetailV2: vi.fn().mockResolvedValue(null),
      };

      const env = {
        DB: mockDb,
        ADMIN_READ_API: mockRpc as unknown as Fetcher,
      } as unknown as AdminEnv;

      const report = await checkReadiness(env);
      expect(report.checks.d1).toBe("degraded");
      expect(report.status).toBe("degraded");

      // DB is undefined
      const reportNoDb = await checkReadiness({} as unknown as AdminEnv);
      expect(reportNoDb.checks.d1).toBe("degraded");
      expect(reportNoDb.checks.rpc).toBe("degraded");
      expect(reportNoDb.status).toBe("degraded");
    });

    it("reports degraded when RPC fails or returns wrong schemaVersion", async () => {
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({ alive: 1 }),
        }),
      } as unknown as D1Database;

      const mockRpcFail = {
        pingV1: vi.fn().mockRejectedValue(new Error("RPC failed")),
        getRunDetailV2: vi.fn().mockResolvedValue(null),
      };

      const env = {
        DB: mockDb,
        ADMIN_READ_API: mockRpcFail as unknown as Fetcher,
      } as unknown as AdminEnv;

      const report = await checkReadiness(env);
      expect(report.checks.rpc).toBe("degraded");
      expect(report.status).toBe("degraded");

      const mockRpcWrongVersion = {
        pingV1: vi.fn().mockResolvedValue({ schemaVersion: 99 }),
        getRunDetailV2: vi.fn().mockResolvedValue(null),
      };
      const envWrong = {
        DB: mockDb,
        ADMIN_READ_API: mockRpcWrongVersion as unknown as Fetcher,
      } as unknown as AdminEnv;

      const reportWrong = await checkReadiness(envWrong);
      expect(reportWrong.checks.rpc).toBe("degraded");
    });

    it("reports degraded when D1 probe times out", async () => {
      vi.useFakeTimers();
      try {
        const mockDb = {
          prepare: vi.fn().mockReturnValue({
            first: vi.fn().mockReturnValue(new Promise(() => {})),
          }),
        } as unknown as D1Database;
        const mockRpc: AdminReadRpcClient = {
          pingV1: vi.fn().mockResolvedValue({ schemaVersion: 1 }),
          getRunDetailV2: vi.fn().mockResolvedValue(null),
        };
        const env = {
          DB: mockDb,
          ADMIN_READ_API: mockRpc as unknown as Fetcher,
        } as unknown as AdminEnv;

        const checkPromise = checkReadiness(env);
        await vi.advanceTimersByTimeAsync(1100);
        const report = await checkPromise;
        expect(report.checks.d1).toBe("degraded");
      } finally {
        vi.useRealTimers();
      }
    });

    it("reports degraded when RPC probe times out", async () => {
      vi.useFakeTimers();
      try {
        const mockDb = {
          prepare: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue({ alive: 1 }),
          }),
        } as unknown as D1Database;
        const mockRpc: AdminReadRpcClient = {
          pingV1: vi.fn().mockReturnValue(new Promise(() => {})),
          getRunDetailV2: vi.fn().mockResolvedValue(null),
        };
        const env = {
          DB: mockDb,
          ADMIN_READ_API: mockRpc as unknown as Fetcher,
        } as unknown as AdminEnv;

        const checkPromise = checkReadiness(env);
        await vi.advanceTimersByTimeAsync(2100);
        const report = await checkPromise;
        expect(report.checks.rpc).toBe("degraded");
      } finally {
        vi.useRealTimers();
      }
    });

    it("reports degraded when queue freshness breaches the SLO", async () => {
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({ alive: 1 }),
        }),
      } as unknown as D1Database;
      const mockRpc: AdminReadRpcClient = {
        pingV1: vi.fn().mockResolvedValue({ schemaVersion: 1 }),
        getRunDetailV2: vi.fn().mockResolvedValue(null),
      };
      const oldTimestamp = Date.now() - 10 * 60 * 1000;
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("analytics_engine")) {
          return Promise.resolve(
            new Response(JSON.stringify({ data: [] }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              result: {
                backlog_count: url.includes("queue-main") ? 1 : 0,
                oldest_message_timestamp_ms: url.includes("queue-main")
                  ? oldTimestamp
                  : 0,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      });
      const report = await checkReadiness(
        {
          DB: mockDb,
          ADMIN_READ_API: mockRpc,
          CF_ACCOUNT_ID: "acc-1",
          CF_ANALYTICS_API_TOKEN: "tok-1",
          CF_QUEUES_READ_TOKEN: "tok-2",
          PROJECTION_QUEUE_ID: "queue-main",
          PROJECTION_DLQ_ID: "queue-dlq",
        } as unknown as AdminEnv,
        mockFetch,
      );
      expect(report.checks.queueMetrics).toBe("degraded");
      expect(report.status).toBe("degraded");
    });
  });
});
