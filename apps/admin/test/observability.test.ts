import { describe, expect, it, vi } from "vitest";

import type { AdminEnv } from "../workers/app.js";
import { queryAnalyticsTrend } from "../workers/observability/analytics-client.js";
import { queryQueueHealth } from "../workers/observability/queue-metrics-client.js";
import {
  type AdminReadRpcClient,
  checkReadiness,
} from "../workers/observability/readiness.js";

describe("Observability clients and readiness probe", () => {
  describe("queryAnalyticsTrend", () => {
    it("returns unavailable when accountId or apiToken is missing", async () => {
      const res = await queryAnalyticsTrend("24h", {});
      expect(res.status).toBe("unavailable");
      if (res.status === "unavailable") {
        expect(res.reason).toBe("missing_credentials");
      }
    });

    it("parses successful analytics response and returns quantiles", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                latency_quantiles: [1200, 3500],
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
      }
    });

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
      }
    });

    it("handles upstream error gracefully without throwing", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(new Response("Server Error", { status: 500 }));

      const res = await queryAnalyticsTrend("7d", {
        accountId: "acc-123",
        apiToken: "tok-456",
        fetchFn: mockFetch,
      });

      expect(res.status).toBe("unavailable");
    });

    it("handles fetch rejection or json parse error", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));

      const res = await queryAnalyticsTrend("24h", {
        accountId: "acc-123",
        apiToken: "tok-456",
        fetchFn: mockFetch,
      });

      expect(res.status).toBe("unavailable");
      if (res.status === "unavailable") {
        expect(res.reason).toBe("request_failed");
      }
    });
  });

  describe("queryQueueHealth", () => {
    it("returns unavailable when config is missing", async () => {
      const res = await queryQueueHealth({});
      expect(res.status).toBe("unavailable");
      if (res.status === "unavailable") {
        expect(res.reason).toBe("missing_configuration");
      }
    });

    it("parses queue metrics and detects healthy state", async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("queue-main")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                result: { messages: 5, delayed_messages: 0 },
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              result: { messages: 0 },
            }),
            { status: 200 },
          ),
        );
      });

      const res = await queryQueueHealth({
        accountId: "acc-1",
        apiToken: "tok-1",
        queueId: "queue-main",
        dlqId: "queue-dlq",
        fetchFn: mockFetch,
      });

      expect(res.status).toBe("ok");
      if (res.status === "ok") {
        expect(res.data.backlogCount).toBe(5);
        expect(res.data.dlqCount).toBe(0);
        expect(res.data.isDegraded).toBe(false);
      }
    });

    it("works without dlqId configured", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            result: { messages: 2, delayed_messages: 1 },
          }),
          { status: 200 },
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

    it("detects degraded state when DLQ has messages or backlog > 100", async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("queue-main")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                result: { messages: 0, delayed_messages: 0 },
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              result: { messages: 3 },
            }),
            { status: 200 },
          ),
        );
      });

      const res = await queryQueueHealth({
        accountId: "acc-1",
        apiToken: "tok-1",
        queueId: "queue-main",
        dlqId: "queue-dlq",
        fetchFn: mockFetch,
      });

      expect(res.status).toBe("ok");
      if (res.status === "ok") {
        expect(res.data.dlqCount).toBe(3);
        expect(res.data.isDegraded).toBe(true);
      }
    });

    it("handles upstream queue API failure", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(new Response("Queue not found", { status: 404 }));

      const res = await queryQueueHealth({
        accountId: "acc-1",
        apiToken: "tok-1",
        queueId: "queue-missing",
        fetchFn: mockFetch,
      });

      expect(res.status).toBe("unavailable");
      if (res.status === "unavailable") {
        expect(res.reason).toBe("queue_api_error");
      }
    });

    it("handles fetch rejection or network error", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));

      const res = await queryQueueHealth({
        accountId: "acc-1",
        apiToken: "tok-1",
        queueId: "queue-main",
        fetchFn: mockFetch,
      });

      expect(res.status).toBe("unavailable");
      if (res.status === "unavailable") {
        expect(res.reason).toBe("request_failed");
      }
    });
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
        getRunDetailV1: vi.fn().mockResolvedValue(null),
      };

      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("analytics_engine")) {
          return Promise.resolve(
            new Response(JSON.stringify({ data: [] }), { status: 200 }),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({ result: { messages: 0, delayed_messages: 0 } }),
            { status: 200 },
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
        getRunDetailV1: vi.fn().mockResolvedValue(null),
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
        getRunDetailV1: vi.fn().mockResolvedValue(null),
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
        getRunDetailV1: vi.fn().mockResolvedValue(null),
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
        getRunDetailV1: vi.fn().mockResolvedValue(null),
      };
      const envWrong = {
        DB: mockDb,
        ADMIN_READ_API: mockRpcWrongVersion as unknown as Fetcher,
      } as unknown as AdminEnv;

      const reportWrong = await checkReadiness(envWrong);
      expect(reportWrong.checks.rpc).toBe("degraded");
    });
  });
});
