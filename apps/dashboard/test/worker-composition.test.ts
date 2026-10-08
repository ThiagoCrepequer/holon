import { describe, expect, it, vi } from "vitest";

// Mock React Router server-build handler so static routes render 200 without needing Vite build
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    createRequestHandler: () => async () =>
      new Response("<!DOCTYPE html><html><body>Dashboard</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
  };
});

// RPC runtime is exercised by the native browser harness; this suite isolates HTTP composition.
vi.mock("../workers/github-access-events.js", () => ({
  GitHubAccessEvents: class {},
}));

import worker, { type DashboardWorkerBindings } from "../workers/index.js";

const prodOrigin = "https://holon-dashboard.thiago-crepequer.workers.dev";
const registeredOriginsJson = JSON.stringify({
  preview: [],
  production: [prodOrigin],
});
const testAuthSecret = "synthetic-secret-at-least-32-chars-long-00001";

const defaultMeta: D1Meta & Record<string, unknown> = {
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: 0,
  last_row_id: 0,
  changed_db: false,
  changes: 0,
};

function fakeD1(): D1Database {
  const statement: D1PreparedStatement = {
    bind(..._values: unknown[]) {
      return statement;
    },
    first: async () => ({
      count: 1,
      window_start: Date.now(),
    }),
    run: async () => ({
      success: true,
      meta: defaultMeta,
      results: [],
    }),
    all: async () => ({
      success: true,
      meta: defaultMeta,
      results: [],
    }),
    raw: (async () => []) as unknown as D1PreparedStatement["raw"],
  };

  return {
    prepare(_query: string): D1PreparedStatement {
      return statement;
    },
    async batch<T = unknown>(
      _statements: D1PreparedStatement[],
    ): Promise<D1Result<T>[]> {
      return [];
    },
    async exec(_query: string): Promise<D1ExecResult> {
      return { count: 0, duration: 0 };
    },
    withSession(): D1DatabaseSession {
      return {
        prepare: () => statement,
        batch: async () => [],
        getBookmark: () => null,
      };
    },
    async dump(): Promise<ArrayBuffer> {
      return new ArrayBuffer(0);
    },
  };
}

describe("Dashboard Worker composition", () => {
  it("serves HTTPS production with full synthetic credentials and homologated origins", async () => {
    const env: DashboardWorkerBindings = {
      APP_ORIGIN: prodOrigin,
      AUTH_ENVIRONMENT: "production",
      AUTH_REGISTERED_ORIGINS: registeredOriginsJson,
      AUTH_ENABLED: "true",
      AUTH_SECRET: testAuthSecret,
      GITHUB_APP_CLIENT_ID: "synthetic_client_id",
      GITHUB_APP_CLIENT_SECRET: "synthetic_client_secret",
      IDENTITY_DB: fakeD1(),
    };

    const request = new Request(`${prodOrigin}/api/auth/session`);
    const response = await worker.fetch(request, env as unknown as Env);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });

  it("fails closed (503) when production origin is not homologated", async () => {
    const unhomologatedOrigin = "https://unhomologated.example.invalid";
    const env: DashboardWorkerBindings = {
      APP_ORIGIN: unhomologatedOrigin,
      AUTH_ENVIRONMENT: "production",
      AUTH_REGISTERED_ORIGINS: registeredOriginsJson,
      AUTH_ENABLED: "true",
      AUTH_SECRET: testAuthSecret,
      GITHUB_APP_CLIENT_ID: "synthetic_client_id",
      GITHUB_APP_CLIENT_SECRET: "synthetic_client_secret",
      IDENTITY_DB: fakeD1(),
    };

    const request = new Request(`${unhomologatedOrigin}/api/auth/session`);
    const response = await worker.fetch(request, env as unknown as Env);

    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unavailable");
  });

  it("handles explicit bootstrap mode with AUTH_ENABLED='false' and only AUTH_SECRET", async () => {
    const env: DashboardWorkerBindings = {
      APP_ORIGIN: prodOrigin,
      AUTH_ENVIRONMENT: "production",
      AUTH_REGISTERED_ORIGINS: registeredOriginsJson,
      AUTH_ENABLED: "false",
      AUTH_SECRET: testAuthSecret, // only AUTH_SECRET, no GitHub credentials
    };

    // Static page renders successfully
    const staticRequest = new Request(`${prodOrigin}/`);
    const staticResponse = await worker.fetch(
      staticRequest,
      env as unknown as Env,
    );
    expect(staticResponse.status).toBe(200);
    const text = await staticResponse.text();
    expect(text).toContain("Dashboard");

    // Protected auth endpoints return 404 (auth service not configured)
    const authRequest = new Request(`${prodOrigin}/api/auth/session`);
    const authResponse = await worker.fetch(authRequest, env as unknown as Env);
    expect(authResponse.status).toBe(404);

    // Protected tenancy endpoints return 503 (tenancy unavailable)
    const tenancyRequest = new Request(
      `${prodOrigin}/api/workspaces/personal`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const tenancyResponse = await worker.fetch(
      tenancyRequest,
      env as unknown as Env,
    );
    expect(tenancyResponse.status).toBe(503);
  });

  it("fails closed on invalid remote configuration", async () => {
    // Invalid JSON for AUTH_REGISTERED_ORIGINS
    const badJsonEnv: DashboardWorkerBindings = {
      APP_ORIGIN: prodOrigin,
      AUTH_ENVIRONMENT: "production",
      AUTH_REGISTERED_ORIGINS: "invalid-json",
      AUTH_ENABLED: "false",
    };
    const res1 = await worker.fetch(
      new Request(`${prodOrigin}/`),
      badJsonEnv as unknown as Env,
    );
    expect(res1.status).toBe(503);

    // Invalid schema for AUTH_REGISTERED_ORIGINS
    const badSchemaEnv: DashboardWorkerBindings = {
      APP_ORIGIN: prodOrigin,
      AUTH_ENVIRONMENT: "production",
      AUTH_REGISTERED_ORIGINS: JSON.stringify({ preview: "not-an-array" }),
      AUTH_ENABLED: "false",
    };
    const res2 = await worker.fetch(
      new Request(`${prodOrigin}/`),
      badSchemaEnv as unknown as Env,
    );
    expect(res2.status).toBe(503);

    // Invalid AUTH_ENVIRONMENT enum
    const badEnvEnv: DashboardWorkerBindings = {
      APP_ORIGIN: prodOrigin,
      AUTH_ENVIRONMENT: "staging",
      AUTH_REGISTERED_ORIGINS: registeredOriginsJson,
      AUTH_ENABLED: "false",
    };
    const res3 = await worker.fetch(
      new Request(`${prodOrigin}/`),
      badEnvEnv as unknown as Env,
    );
    expect(res3.status).toBe(503);

    // Invalid AUTH_ENABLED value
    const badEnabledEnv: DashboardWorkerBindings = {
      APP_ORIGIN: prodOrigin,
      AUTH_ENABLED: "yes",
    };
    const res4 = await worker.fetch(
      new Request(`${prodOrigin}/`),
      badEnabledEnv as unknown as Env,
    );
    expect(res4.status).toBe(503);
  });

  it("fails closed when AUTH_ENABLED='true' but trio or D1 is missing", async () => {
    // Missing client secret and D1
    const missingSecretEnv: DashboardWorkerBindings = {
      APP_ORIGIN: prodOrigin,
      AUTH_ENVIRONMENT: "production",
      AUTH_REGISTERED_ORIGINS: registeredOriginsJson,
      AUTH_ENABLED: "true",
      AUTH_SECRET: testAuthSecret,
      GITHUB_APP_CLIENT_ID: "client_id",
      // missing GITHUB_APP_CLIENT_SECRET
      IDENTITY_DB: fakeD1(),
    };
    const res1 = await worker.fetch(
      new Request(`${prodOrigin}/api/auth/session`),
      missingSecretEnv as unknown as Env,
    );
    expect(res1.status).toBe(503);

    // Missing D1
    const missingD1Env: DashboardWorkerBindings = {
      APP_ORIGIN: prodOrigin,
      AUTH_ENVIRONMENT: "production",
      AUTH_REGISTERED_ORIGINS: registeredOriginsJson,
      AUTH_ENABLED: "true",
      AUTH_SECRET: testAuthSecret,
      GITHUB_APP_CLIENT_ID: "client_id",
      GITHUB_APP_CLIENT_SECRET: "client_secret",
      // missing IDENTITY_DB
    };
    const res2 = await worker.fetch(
      new Request(`${prodOrigin}/api/auth/session`),
      missingD1Env as unknown as Env,
    );
    expect(res2.status).toBe(503);
  });

  it("preserves local behavior when AUTH_ENABLED is absent", async () => {
    const localOrigin = "http://127.0.0.1:8794";

    // No secrets: static works, auth 404
    const noSecretsEnv: DashboardWorkerBindings = {
      APP_ORIGIN: localOrigin,
    };
    const staticRes = await worker.fetch(
      new Request(`${localOrigin}/`),
      noSecretsEnv as unknown as Env,
    );
    expect(staticRes.status).toBe(200);

    const authRes = await worker.fetch(
      new Request(`${localOrigin}/api/auth/session`),
      noSecretsEnv as unknown as Env,
    );
    expect(authRes.status).toBe(404);

    // Partial secrets: 503
    const partialEnv: DashboardWorkerBindings = {
      APP_ORIGIN: localOrigin,
      AUTH_SECRET: testAuthSecret,
    };
    const partialRes = await worker.fetch(
      new Request(`${localOrigin}/`),
      partialEnv as unknown as Env,
    );
    expect(partialRes.status).toBe(503);
  });
});
