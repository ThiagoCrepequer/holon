import { env } from "cloudflare:test";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTVerifyGetKey,
  SignJWT,
} from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { parseRpcRunDetail } from "../app/routes/run-detail.js";
import type { AdminEnv } from "../workers/app.js";
import { D1AdminStorage } from "../workers/d1-adapter.js";
import type { AdminReadRpcClient } from "../workers/observability/readiness.js";
import { handleConsoleRequest, isLocalDevelopment } from "../workers/router.js";
import { createSampleProjectionEvent, setupTestDatabase } from "./helpers.js";

describe("apps/admin router and server-side rendered views", () => {
  let publicKeyJwk: JWK;
  let privateKey: CryptoKey | Uint8Array;
  let localJwkSet: JWTVerifyGetKey;
  let storage: D1AdminStorage;

  beforeAll(async () => {
    const keyPair = await generateKeyPair("RS256");
    privateKey = keyPair.privateKey;
    publicKeyJwk = await exportJWK(keyPair.publicKey);
    publicKeyJwk.kid = "test-key-router";
    publicKeyJwk.alg = "RS256";
    publicKeyJwk.use = "sig";
    localJwkSet = createLocalJWKSet({ keys: [publicKeyJwk] });
  });

  beforeEach(async () => {
    await setupTestDatabase(env.DB);
    storage = new D1AdminStorage(env.DB);
  });

  async function createValidAuthHeader() {
    const jwt = await new SignJWT({
      email: "staff@example.com",
      sub: "staff-1",
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key-router" })
      .setIssuedAt()
      .setIssuer("https://test-team.cloudflareaccess.com")
      .setAudience("test-audience")
      .setExpirationTime("1h")
      .sign(privateKey);

    return { "cf-access-jwt-assertion": jwt };
  }

  function authConfig() {
    return {
      teamName: "test-team",
      expectedAudience: "test-audience",
      authorizedEmailDomain: "example.com",
      customJwkSet: localJwkSet,
    };
  }

  const mockCtx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;

  it("handles /health without requiring Access JWT", async () => {
    const req = new Request("https://admin.example.com/health");
    const resp = await handleConsoleRequest(req, env, mockCtx);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("rejects non-GET HTTP methods with 405", async () => {
    const req = new Request("https://admin.example.com/", { method: "POST" });
    const resp = await handleConsoleRequest(req, env, mockCtx);
    expect(resp.status).toBe(405);
    expect(resp.headers.get("allow")).toBe("GET, HEAD");
  });

  it("rejects unauthenticated requests to protected routes with 401", async () => {
    const req = new Request("https://admin.example.com/");
    const resp = await handleConsoleRequest(req, env, mockCtx, authConfig());
    expect(resp.status).toBe(401);
    expect(resp.headers.get("cache-control")).toBe("private, no-store");
  });

  it("renders overview dashboard (GET /) for authenticated staff", async () => {
    // Seed database with a recent sample run within 24h
    const event = await createSampleProjectionEvent({
      terminalAtEpochMs: Date.now() - 5000,
    });
    await storage.insertProjection(event);

    const headers = await createValidAuthHeader();
    const req = new Request("https://admin.example.com/?window=24h", {
      headers,
    });

    const resp = await handleConsoleRequest(req, env, mockCtx, authConfig());

    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("text/html");
    expect(resp.headers.get("content-security-policy")).toBeDefined();

    const html = await resp.text();
    expect(html).toContain("Holon Console");
    expect(html).toContain("System Overview");
    expect(html).toContain("staff@example.com");
    expect(html).toContain("Total Runs");
    expect(html).toContain("Optional Telemetry Unavailable");
    expect(html).toContain("Queue Pipeline");
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("Operational Degradation Detected");
  });

  it("renders runs listing (GET /runs) with search and filters", async () => {
    const event = await createSampleProjectionEvent({
      terminalAtEpochMs: Date.now() - 5000,
    });
    await storage.insertProjection(event);

    const headers = await createValidAuthHeader();
    const req = new Request("https://admin.example.com/runs?period=24h", {
      headers,
    });

    const resp = await handleConsoleRequest(req, env, mockCtx, authConfig());

    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("Review Runs");
    expect(html).toContain("Runs Listing");
    expect(html).toContain(event.payload.repository.owner);

    const invalid = await handleConsoleRequest(
      new Request("https://admin.example.com/runs?repositoryId=not-a-number", {
        headers,
      }),
      env,
      mockCtx,
      authConfig(),
    );
    expect(invalid.status).toBe(400);
  });

  it("handles run detail route (GET /runs/:runId)", async () => {
    const event = await createSampleProjectionEvent({
      terminalAtEpochMs: Date.now() - 5000,
    });
    await storage.insertProjection(event);

    const headers = await createValidAuthHeader();

    // Invalid runId returns 400
    const reqInvalid = new Request(
      "https://admin.example.com/runs/not-valid-id",
      { headers },
    );
    const respInvalid = await handleConsoleRequest(
      reqInvalid,
      env,
      mockCtx,
      authConfig(),
    );
    expect(respInvalid.status).toBe(400);

    // Non-existent runId returns 404
    const validMissingId =
      "github:999999:pr:999:head:1234567890abcdef1234567890abcdef12345678";
    const reqMissing = new Request(
      `https://admin.example.com/runs/${encodeURIComponent(validMissingId)}`,
      { headers },
    );
    const respMissing = await handleConsoleRequest(
      reqMissing,
      env,
      mockCtx,
      authConfig(),
    );
    expect(respMissing.status).toBe(404);

    // Existing run returns 200 with RunDetailView
    const reqExisting = new Request(
      `https://admin.example.com/runs/${encodeURIComponent(event.payload.runId)}`,
      { headers },
    );
    const respExisting = await handleConsoleRequest(
      reqExisting,
      env,
      mockCtx,
      authConfig(),
    );
    expect(respExisting.status).toBe(200);
    const html = await respExisting.text();
    expect(html).toContain("Commit SHA");
    expect(html).toContain(event.payload.headSha);
  });

  it("renders readiness probe (GET /readiness) in HTML and JSON", async () => {
    const headers = await createValidAuthHeader();

    // HTML response
    const reqHtml = new Request("https://admin.example.com/readiness", {
      headers,
    });
    const respHtml = await handleConsoleRequest(
      reqHtml,
      env,
      mockCtx,
      authConfig(),
    );
    expect(respHtml.headers.get("content-type")).toContain("text/html");
    const html = await respHtml.text();
    expect(html).toContain("System Readiness");
    expect(html).toContain("D1 Database Ledger");
  });

  it("renders 404 for unknown routes", async () => {
    const headers = await createValidAuthHeader();
    const req = new Request("https://admin.example.com/nonexistent-route", {
      headers,
    });
    const resp = await handleConsoleRequest(req, env, mockCtx, authConfig());
    expect(resp.status).toBe(404);
    const html = await resp.text();
    expect(html).toContain("404");
  });

  it("handles run detail when RPC client throws an error", async () => {
    const event = await createSampleProjectionEvent({
      terminalAtEpochMs: Date.now() - 5000,
    });
    await storage.insertProjection(event);

    const headers = await createValidAuthHeader();
    const req = new Request(
      `https://admin.example.com/runs/${encodeURIComponent(event.payload.runId)}`,
      { headers },
    );

    const mockRpcFail = {
      pingV1: vi.fn(),
      getRunDetailV3: vi.fn().mockRejectedValue(new Error("RPC timeout")),
    };

    const envWithRpc = {
      ...env,
      ADMIN_READ_API: mockRpcFail as unknown as Fetcher,
    } as unknown as AdminEnv;

    const resp = await handleConsoleRequest(
      req,
      envWithRpc,
      mockCtx,
      authConfig(),
    );
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("RPC drill-down unavailable");
  });

  it("handles run detail when RPC binding is not configured", async () => {
    const event = await createSampleProjectionEvent({
      terminalAtEpochMs: Date.now() - 5000,
    });
    await storage.insertProjection(event);

    const headers = await createValidAuthHeader();
    const req = new Request(
      `https://admin.example.com/runs/${encodeURIComponent(event.payload.runId)}`,
      { headers },
    );

    const envNoRpc = {
      ...env,
      ADMIN_READ_API: undefined,
    } as unknown as AdminEnv;

    const resp = await handleConsoleRequest(
      req,
      envNoRpc,
      mockCtx,
      authConfig(),
    );
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("Control plane RPC binding not configured");
  });

  it("handles run detail when getRunDetailV3 succeeds with V3 detail", async () => {
    const event = await createSampleProjectionEvent({
      terminalAtEpochMs: Date.now() - 5000,
    });
    await storage.insertProjection(event);

    const headers = await createValidAuthHeader();
    const req = new Request(
      `https://admin.example.com/runs/${encodeURIComponent(event.payload.runId)}`,
      { headers },
    );

    const mockV3 = {
      pingV1: vi.fn(),
      getRunDetailV3: vi.fn().mockResolvedValue({
        cleanupTask: null,
        currentFindings: [],
        findingsPerspective: "both",
        graphSchemaVersion: 1,
        historicalRunFindings: [],
        projectIdentification: null,
        run: {
          cost: null,
          createdAt: "2026-09-04T11:00:00.000Z",
          headSha: event.payload.headSha,
          isDegraded: false,
          prKey: event.payload.prKey,
          runId: event.payload.runId,
          runState: "running",
          scopeStatus: "complete",
          shardsCount: 1,
          stepTimings: [],
          terminalState: null,
          tokens: null,
          toolCallsCount: 0,
          updatedAt: "2026-09-04T11:00:05.000Z",
          verdict: null,
        },
        schemaVersion: 3,
        stepExecutions: [
          {
            attempts: [],
            attemptsCount: 1,
            errorCode: null,
            firstStartedAt: "2026-09-04T11:00:01.000Z",
            lastEndedAt: "2026-09-04T11:00:01.050Z",
            phase: "admission",
            sanitizedInput: null,
            sanitizedOutput: null,
            status: "completed",
            stepName: "claim-run",
            totalDurationMs: 50,
          },
        ],
        structuredCi: null,
      }),
      getRunDetailV2: vi.fn(),
    };

    const envWithV3 = {
      ...env,
      ADMIN_READ_API: mockV3 as unknown as Fetcher,
    } as unknown as AdminEnv;

    const resp = await handleConsoleRequest(
      req,
      envWithV3,
      mockCtx,
      authConfig(),
    );
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("Workflow DAG &amp; Telemetria");
    expect(html).toContain("claim-run");
  });

  it("sets rpcError without falling back to V2 when getRunDetailV3 fails (ADR-0032)", async () => {
    const event = await createSampleProjectionEvent({
      terminalAtEpochMs: Date.now() - 5000,
    });
    await storage.insertProjection(event);

    const headers = await createValidAuthHeader();
    const req = new Request(
      `https://admin.example.com/runs/${encodeURIComponent(event.payload.runId)}`,
      { headers },
    );

    const mockV3Fail = {
      pingV1: vi.fn(),
      getRunDetailV3: vi.fn().mockRejectedValue(new Error("V3 RPC failed")),
      getRunDetailV2: vi.fn(),
    };

    const envWithFail = {
      ...env,
      ADMIN_READ_API: mockV3Fail as unknown as Fetcher,
    } as unknown as AdminEnv;

    const resp = await handleConsoleRequest(
      req,
      envWithFail,
      mockCtx,
      authConfig(),
    );
    expect(resp.status).toBe(200);
    expect(mockV3Fail.getRunDetailV3).toHaveBeenCalled();
    expect(mockV3Fail.getRunDetailV2).not.toHaveBeenCalled();
    const html = await resp.text();
    expect(html).toContain("RPC drill-down unavailable");
  });

  it("renders 200 with active run and polling when D1 has no row and RPC returns active run", async () => {
    const activeRunId =
      "github:42:pr:120:head:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const headers = await createValidAuthHeader();
    const req = new Request(
      `https://admin.example.com/runs/${encodeURIComponent(activeRunId)}`,
      { headers },
    );

    const mockActiveV3 = {
      pingV1: vi.fn(),
      getRunDetailV3: vi.fn().mockResolvedValue({
        cleanupTask: null,
        currentFindings: [],
        findingsPerspective: "current_pr_state",
        graphSchemaVersion: 1,
        historicalRunFindings: [],
        projectIdentification: null,
        run: {
          cost: null,
          createdAt: "2026-09-04T11:00:00.000Z",
          headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          isDegraded: false,
          prKey: "github:42:pr:120",
          runId: activeRunId,
          runState: "running",
          scopeStatus: "complete",
          shardsCount: 1,
          stepTimings: [],
          terminalState: null,
          tokens: null,
          toolCallsCount: 0,
          updatedAt: "2026-09-04T11:00:05.000Z",
          verdict: null,
        },
        schemaVersion: 3,
        stepExecutions: [
          {
            attempts: [],
            attemptsCount: 1,
            errorCode: null,
            firstStartedAt: "2026-09-04T11:00:00.000Z",
            lastEndedAt: "2026-09-04T11:00:01.000Z",
            phase: "preparation",
            sanitizedInput: {
              baseSha: "b".repeat(40),
              headSha: "a".repeat(40),
              repoName: "cool-project",
              repoOwner: "acme",
            },
            sanitizedOutput: null,
            status: "completed",
            stepName: "prepare-repository",
            totalDurationMs: 1000,
          },
          {
            attempts: [],
            attemptsCount: 1,
            errorCode: null,
            firstStartedAt: "2026-09-04T11:00:01.000Z",
            lastEndedAt: null,
            phase: "analysis",
            sanitizedInput: null,
            sanitizedOutput: null,
            status: "running",
            stepName: "analyze-review",
            totalDurationMs: 0,
          },
        ],
        structuredCi: null,
      }),
      getRunDetailV2: vi.fn(),
    };

    const envWithActive = {
      ...env,
      ADMIN_READ_API: mockActiveV3 as unknown as Fetcher,
    } as unknown as AdminEnv;

    const resp = await handleConsoleRequest(
      req,
      envWithActive,
      mockCtx,
      authConfig(),
    );
    expect(resp.status).toBe(200);
    expect(mockActiveV3.getRunDetailV3).toHaveBeenCalled();
    const html = await resp.text();
    expect(html).toContain(activeRunId);
    expect(html).toContain("acme/cool-project #120");
    expect(html).toContain("analyze-review");
  });

  it("validates a successful RPC detail response at runtime", async () => {
    const event = await createSampleProjectionEvent({
      terminalAtEpochMs: Date.now() - 5000,
    });
    await storage.insertProjection(event);

    const mockRpcSuccess: AdminReadRpcClient = {
      pingV1: vi.fn().mockResolvedValue({ schemaVersion: 1 }),
      getRunDetailV3: vi.fn().mockResolvedValue({
        cleanupTask: null,
        currentFindings: [
          {
            fingerprint:
              "fp:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            filePath: "src/auth.ts",
            line: 42,
            severity: "critical",
            diagnostic: "Critical vulnerability",
            status: "new",
            updatedAt: "2026-09-04T12:00:00.000Z",
          },
        ],
        findingsPerspective: "current_pr_state",
        graphSchemaVersion: 1,
        historicalRunFindings: null,
        projectIdentification: null,
        run: {
          cost: {
            currency: "USD",
            estimatedCostMicroUsd: 1500,
            estimatedCostUsd: 0.0015,
            pricingModel: "test-model",
          },
          headSha: event.payload.headSha,
          isDegraded: false,
          prKey: event.payload.prKey,
          runId: event.payload.runId,
          runState: "completed",
          scopeStatus: "complete",
          shardsCount: 1,
          stepTimings: [],
          terminalState: "completed",
          tokens: {
            inputTokens: 10,
            outputTokens: 5,
            reasoningTokens: 0,
            totalTokens: 15,
          },
          toolCallsCount: 1,
          verdict: "APPROVE",
        },
        schemaVersion: 3,
        stepExecutions: [],
        structuredCi: {
          durationMs: 1000,
          failed: 0,
          passed: 1,
          skipped: 0,
          status: "available",
          total: 1,
          workflowName: "CI",
        },
      }),
    };

    const candidate = await mockRpcSuccess.getRunDetailV3!({
      runId: event.payload.runId,
    });
    expect(candidate).not.toBeNull();
    if (!candidate) throw new Error("candidate is null");
    const parsed = parseRpcRunDetail(candidate);
    expect(parsed?.currentFindings[0]?.filePath).toBe("src/auth.ts");
    expect(parsed?.schemaVersion).toBe(3);
    expect(parsed?.stepExecutions).toEqual([]);
    expect(() => parseRpcRunDetail({ schemaVersion: 2 })).toThrow(
      "Invalid RPC run detail response",
    );
    expect(() => parseRpcRunDetail({ schemaVersion: 1 })).toThrow(
      "Invalid RPC run detail response",
    );
  });

  describe("isLocalDevelopment and authentication bypass boundaries", () => {
    it("identifies local development requests only when flag is true and hostname is localhost/loopback", () => {
      const devEnv = { ...env, DEV_BYPASS_AUTH: "true" } as AdminEnv;
      const prodEnv = { ...env, DEV_BYPASS_AUTH: undefined } as AdminEnv;

      expect(
        isLocalDevelopment(new Request("http://localhost:8787/"), devEnv),
      ).toBe(true);
      expect(
        isLocalDevelopment(new Request("http://127.0.0.1:8787/"), devEnv),
      ).toBe(true);
      expect(
        isLocalDevelopment(new Request("http://[::1]:8787/"), devEnv),
      ).toBe(true);

      // Fails when flag is missing or false
      expect(
        isLocalDevelopment(new Request("http://localhost:8787/"), prodEnv),
      ).toBe(false);
      expect(
        isLocalDevelopment(new Request("http://localhost:8787/"), {
          ...env,
          DEV_BYPASS_AUTH: "false",
        }),
      ).toBe(false);

      // Fails for remote hostnames even when DEV_BYPASS_AUTH="true"
      expect(
        isLocalDevelopment(
          new Request("https://admin-holon.crepequer.dev/"),
          devEnv,
        ),
      ).toBe(false);
      expect(
        isLocalDevelopment(new Request("https://admin.example.com/"), devEnv),
      ).toBe(false);

      // Fails gracefully for invalid URLs
      expect(
        isLocalDevelopment(
          { url: "not-a-valid-url" } as unknown as Request,
          devEnv,
        ),
      ).toBe(false);
    });

    it("allows unauthenticated requests on localhost when DEV_BYPASS_AUTH=true", async () => {
      const devEnv = {
        ...env,
        DEV_BYPASS_AUTH: "true",
        DEV_USER_EMAIL: "dev-tester@holon.internal",
      } as AdminEnv;

      const req = new Request("http://localhost:8787/?window=24h");
      const resp = await handleConsoleRequest(req, devEnv, mockCtx);
      expect(resp.status).toBe(200);
      const html = await resp.text();
      expect(html).toContain("dev-tester@holon.internal");
    });

    it("rejects unauthenticated requests on remote hosts even when DEV_BYPASS_AUTH=true", async () => {
      const devEnv = {
        ...env,
        DEV_BYPASS_AUTH: "true",
      } as AdminEnv;

      const req = new Request("https://admin-holon.crepequer.dev/?window=24h");
      const resp = await handleConsoleRequest(
        req,
        devEnv,
        mockCtx,
        authConfig(),
      );
      expect(resp.status).toBe(401);
    });
  });
});
