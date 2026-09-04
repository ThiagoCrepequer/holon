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

import type { AdminEnv } from "../workers/app.js";
import { D1AdminStorage } from "../workers/d1-adapter.js";
import type { AdminReadRpcClient } from "../workers/observability/readiness.js";
import { handleConsoleRequest } from "../workers/router.js";
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
      .setExpirationTime("1h")
      .sign(privateKey);

    return { "cf-access-jwt-assertion": jwt };
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
    expect(resp.headers.get("allow")).toBe("GET");
  });

  it("rejects unauthenticated requests to protected routes with 401", async () => {
    const req = new Request("https://admin.example.com/");
    const resp = await handleConsoleRequest(req, env, mockCtx, {
      customJwkSet: localJwkSet,
    });
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

    const resp = await handleConsoleRequest(req, env, mockCtx, {
      customJwkSet: localJwkSet,
    });

    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("text/html");
    expect(resp.headers.get("content-security-policy")).toBeDefined();

    const html = await resp.text();
    expect(html).toContain("Holon Console");
    expect(html).toContain("System Overview");
    expect(html).toContain("staff@example.com");
    expect(html).toContain("Total Runs");
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

    const resp = await handleConsoleRequest(req, env, mockCtx, {
      customJwkSet: localJwkSet,
    });

    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("Review Runs");
    expect(html).toContain("Runs Listing");
    expect(html).toContain(event.payload.repository.owner);
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
    const respInvalid = await handleConsoleRequest(reqInvalid, env, mockCtx, {
      customJwkSet: localJwkSet,
    });
    expect(respInvalid.status).toBe(400);

    // Non-existent runId returns 404
    const validMissingId =
      "github:999999:pr:999:head:1234567890abcdef1234567890abcdef12345678";
    const reqMissing = new Request(
      `https://admin.example.com/runs/${encodeURIComponent(validMissingId)}`,
      { headers },
    );
    const respMissing = await handleConsoleRequest(reqMissing, env, mockCtx, {
      customJwkSet: localJwkSet,
    });
    expect(respMissing.status).toBe(404);

    // Existing run returns 200 with RunDetailView
    const reqExisting = new Request(
      `https://admin.example.com/runs/${encodeURIComponent(event.payload.runId)}`,
      { headers },
    );
    const respExisting = await handleConsoleRequest(reqExisting, env, mockCtx, {
      customJwkSet: localJwkSet,
    });
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
    const respHtml = await handleConsoleRequest(reqHtml, env, mockCtx, {
      customJwkSet: localJwkSet,
    });
    expect(respHtml.headers.get("content-type")).toContain("text/html");
    const html = await respHtml.text();
    expect(html).toContain("System Readiness");
    expect(html).toContain("D1 Database Ledger");

    // JSON response via Accept header
    const reqJson = new Request("https://admin.example.com/readiness", {
      headers: { ...headers, accept: "application/json" },
    });
    const respJson = await handleConsoleRequest(reqJson, env, mockCtx, {
      customJwkSet: localJwkSet,
    });
    expect(respJson.headers.get("content-type")).toContain("application/json");
    const json = (await respJson.json()) as { status: string; checks: unknown };
    expect(json.status).toBeDefined();
  });

  it("renders 404 for unknown routes", async () => {
    const headers = await createValidAuthHeader();
    const req = new Request("https://admin.example.com/nonexistent-route", {
      headers,
    });
    const resp = await handleConsoleRequest(req, env, mockCtx, {
      customJwkSet: localJwkSet,
    });
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
      getRunDetailV1: vi.fn().mockRejectedValue(new Error("RPC timeout")),
    };

    const envWithRpc = {
      ...env,
      ADMIN_READ_API: mockRpcFail as unknown as Fetcher,
    } as unknown as AdminEnv;

    const resp = await handleConsoleRequest(req, envWithRpc, mockCtx, {
      customJwkSet: localJwkSet,
    });
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("RPC drill-down unavailable");
  });

  it("handles run detail when RPC client returns successful detail", async () => {
    const event = await createSampleProjectionEvent({
      terminalAtEpochMs: Date.now() - 5000,
    });
    await storage.insertProjection(event);

    const headers = await createValidAuthHeader();
    const req = new Request(
      `https://admin.example.com/runs/${encodeURIComponent(event.payload.runId)}`,
      { headers },
    );

    const mockRpcSuccess: AdminReadRpcClient = {
      pingV1: vi.fn().mockResolvedValue({ schemaVersion: 1 }),
      getRunDetailV1: vi.fn().mockResolvedValue({
        runId: event.payload.runId,
        schemaVersion: 1,
        retrievedAt: new Date().toISOString(),
        currentFindings: [
          {
            fingerprint:
              "fp:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            filePath: "src/auth.ts",
            line: 42,
            severity: "critical",
            diagnostic: "Critical vulnerability",
            status: "new",
          },
        ],
        structuredCi: { status: "available", checkCount: 1 },
      }),
    };

    const envWithRpc = {
      ...env,
      ADMIN_READ_API: mockRpcSuccess as unknown as Fetcher,
    } as unknown as AdminEnv;

    const resp = await handleConsoleRequest(req, envWithRpc, mockCtx, {
      customJwkSet: localJwkSet,
    });
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("src/auth.ts");
    expect(html).toContain("Critical vulnerability");
  });
});
