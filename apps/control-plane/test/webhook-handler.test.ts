import type { HealthCheckReport } from "@holon/contracts";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  createWebhookApp,
  readBoundedRequestBody,
} from "../src/ingress/webhook-handler.js";

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  return `sha256=${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

const validPayload = {
  action: "opened",
  installation: { id: 99 },
  number: 7,
  pull_request: {
    base: { sha: "b".repeat(40) },
    head: { sha: "a".repeat(40) },
    updated_at: "2026-08-29T12:00:00Z",
  },
  repository: {
    full_name: "acme/api",
    id: 42,
    name: "api",
    owner: { login: "acme" },
  },
};

async function request(
  body: string,
  overrides: Record<string, string> = {},
  queueError?: Error,
) {
  const sent: unknown[] = [];
  const signature = await sign("secret", body);
  const response = await createWebhookApp().request(
    "https://holon.test/webhooks/github",
    {
      body,
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "delivery-123",
        "x-github-event": "pull_request",
        "x-hub-signature-256": signature,
        ...overrides,
      },
      method: "POST",
    },
    {
      PROJECT_IDENTIFICATION_REGISTRY: env.PROJECT_IDENTIFICATION_REGISTRY,
      GITHUB_APP_ID: "123",
      GITHUB_APP_PRIVATE_KEY_CURRENT: "fake-key",
      GITHUB_APP_SLUG: "holon-reviewer",
      GITHUB_WEBHOOK_SECRET: "secret",
      REVIEW_QUEUE: {
        send: (message: unknown) => {
          if (queueError !== undefined) return Promise.reject(queueError);
          sent.push(message);
          return Promise.resolve();
        },
      },
    },
  );
  return { response, sent };
}

describe("GitHub webhook HTTP boundary", () => {
  it("queues a valid signed pull request and returns 202", async () => {
    const result = await request(JSON.stringify(validPayload));
    expect(result.response.status).toBe(202);
    expect(result.sent).toHaveLength(1);
    expect(result.sent[0]).toMatchObject({
      deliveryId: "github:delivery-123",
    });
  });

  it("rejects an invalid signature before parsing or queueing", async () => {
    const result = await request("not-json", {
      "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
    });
    expect(result.response.status).toBe(401);
    expect(result.sent).toHaveLength(0);
  });

  it("rejects signed malformed JSON and malformed payloads", async () => {
    await expect(
      request("not-json").then(({ response }) => response.status),
    ).resolves.toBe(400);
    await expect(
      request(JSON.stringify({ action: "opened" })).then(
        ({ response }) => response.status,
      ),
    ).resolves.toBe(400);
  });

  it("accepts but ignores other signed GitHub event types", async () => {
    const result = await request("{}", { "x-github-event": "ping" });
    expect(result.response.status).toBe(202);
    expect(result.sent).toHaveLength(0);
  });

  it("ignores signed workflow_run events after CI artifact retirement", async () => {
    const result = await request(
      JSON.stringify({
        action: "completed",
        workflow_run: { id: 12345, pull_requests: [{ number: 7 }] },
      }),
      { "x-github-event": "workflow_run" },
    );
    expect(result.response.status).toBe(202);
    await expect(result.response.json()).resolves.toEqual({
      accepted: true,
      ignored: true,
    });
    expect(result.sent).toHaveLength(0);
  });

  it("accepts but ignores unsupported pull request actions", async () => {
    const result = await request(
      JSON.stringify({ ...validPayload, action: "closed" }),
    );
    expect(result.response.status).toBe(202);
    expect(result.sent).toHaveLength(0);
  });

  it("returns a retryable HTTP status when the queue is unavailable", async () => {
    const result = await request(
      JSON.stringify(validPayload),
      {},
      new Error("queue unavailable"),
    );
    expect(result.response.status).toBe(503);
    await expect(result.response.json()).resolves.toEqual({
      error: "queue_unavailable",
    });
  });

  it("rejects oversized bodies and exposes only health plus the webhook route", async () => {
    await expect(
      request("x".repeat(2_000_001)).then(({ response }) => response.status),
    ).resolves.toBe(413);
    const app = createWebhookApp();
    expect((await app.request("https://holon.test/health")).status).toBe(200);
    expect((await app.request("https://holon.test/missing")).status).toBe(404);
  });

  it("stops reading a chunked request as soon as the byte limit is exceeded", async () => {
    const streamedRequest = new Request("https://holon.test", {
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3, 4]));
          controller.close();
        },
      }),
      method: "POST",
    });
    await expect(readBoundedRequestBody(streamedRequest, 3)).rejects.toThrow(
      "byte limit",
    );
  });

  it("rejects a declared oversized body before reading and accepts an empty body", async () => {
    await expect(
      readBoundedRequestBody(
        new Request("https://holon.test", {
          body: "data",
          headers: { "content-length": "4" },
          method: "POST",
        }),
        3,
      ),
    ).rejects.toThrow("byte limit");
    await expect(
      readBoundedRequestBody(new Request("https://holon.test"), 3),
    ).resolves.toEqual(new Uint8Array());
  });

  it("handles pull_request_review_comment created event and ignores other actions", async () => {
    const commentPayload = {
      action: "created",
      comment: {
        body: "/holon dismiss false-positive",
        created_at: "2026-09-02T10:00:00Z",
        id: 12345,
        in_reply_to_id: 101,
        user: { login: "alice" },
      },
      installation: { id: 99 },
      pull_request: { number: 7 },
      repository: {
        full_name: "acme/api",
        id: 42,
        name: "api",
        owner: { login: "acme" },
      },
    };

    const createdResult = await request(JSON.stringify(commentPayload), {
      "x-github-event": "pull_request_review_comment",
    });
    expect(createdResult.response.status).toBe(202);
    await expect(createdResult.response.json()).resolves.toMatchObject({
      accepted: true,
      feedback: true,
    });

    const editedResult = await request(
      JSON.stringify({ ...commentPayload, action: "edited" }),
      { "x-github-event": "pull_request_review_comment" },
    );
    expect(editedResult.response.status).toBe(202);
    await expect(editedResult.response.json()).resolves.toMatchObject({
      accepted: true,
      ignored: true,
    });
  });

  it("handles pull_request_review_thread resolved event and ignores other actions", async () => {
    const threadPayload = {
      action: "resolved",
      installation: { id: 99 },
      pull_request: { number: 7 },
      repository: {
        full_name: "acme/api",
        id: 42,
        name: "api",
        owner: { login: "acme" },
      },
      sender: { login: "bob" },
      thread: {
        comments: [{ id: 101 }],
      },
    };

    const resolvedResult = await request(JSON.stringify(threadPayload), {
      "x-github-event": "pull_request_review_thread",
    });
    expect(resolvedResult.response.status).toBe(202);
    await expect(resolvedResult.response.json()).resolves.toMatchObject({
      accepted: true,
      feedback: true,
    });

    const unresolvedResult = await request(
      JSON.stringify({ ...threadPayload, action: "unresolved" }),
      { "x-github-event": "pull_request_review_thread" },
    );
    expect(unresolvedResult.response.status).toBe(202);
    await expect(unresolvedResult.response.json()).resolves.toMatchObject({
      accepted: true,
      ignored: true,
    });
  });

  it("serves health and healthz endpoints accurately", async () => {
    const app = createWebhookApp();
    const resHealth = await app.request("http://localhost/health");
    expect(resHealth.status).toBe(200);
    await expect(resHealth.json()).resolves.toEqual({ status: "ok" });

    // Degraded healthcheck: missing env bindings
    const resDegraded = await app.request("http://localhost/healthz");
    expect(resDegraded.status).toBe(503);
    const degradedReport = (await resDegraded.json()) as HealthCheckReport;
    expect(degradedReport.status).toBe("degraded");
    expect(degradedReport.checks).toEqual({
      aiGateway: false,
      database: false,
      executor: false,
    });

    // A legacy binding cannot satisfy the current executor contract.
    const resLegacyExecutor = await app.request(
      "http://localhost/healthz",
      undefined,
      {
        AI_GATEWAY_ACCOUNT_ID: "acc-1",
        AI_GATEWAY_API_TOKEN: "tok-1",
        AI_GATEWAY_ID: "gw-1",
        REVIEW_LEDGERS: {} as unknown as DurableObjectNamespace,
        SANDBOX: {} as unknown as Fetcher,
      },
    );
    expect(resLegacyExecutor.status).toBe(503);
    await expect(resLegacyExecutor.json()).resolves.toMatchObject({
      checks: { aiGateway: true, database: true, executor: false },
      status: "degraded",
    });

    // Fully configured healthcheck; it does not probe remote availability.
    const resHealthy = await app.request(
      "http://localhost/healthz",
      undefined,
      {
        AI_GATEWAY_ACCOUNT_ID: "acc-1",
        AI_GATEWAY_API_TOKEN: "tok-1",
        AI_GATEWAY_ID: "gw-1",
        REVIEW_LEDGERS: {} as unknown as DurableObjectNamespace,
        REPOSITORY_EXECUTOR: {} as Cloudflare.Env["REPOSITORY_EXECUTOR"],
      },
    );
    expect(resHealthy.status).toBe(200);
    const healthyReport = (await resHealthy.json()) as HealthCheckReport;
    expect(healthyReport.status).toBe("ok");
    expect(healthyReport.checks).toEqual({
      aiGateway: true,
      database: true,
      executor: true,
    });
  });
});

it.each(["deleted", "suspend"])(
  "purges documentation metadata on signed installation %s",
  async (action) => {
    const id = action === "deleted" ? 801 : 802;
    const result = await request(
      JSON.stringify({ action, installation: { id } }),
      { "x-github-event": "installation" },
    );
    expect(result.response.status).toBe(202);
    expect(
      await env.PROJECT_IDENTIFICATION_REGISTRY.getByName(String(id)).register(
        id,
        1,
      ),
    ).toBeNull();
  },
  15_000,
);
it("revokes only removed repositories and validates signed revocation payloads", async () => {
  const id = 803;
  expect(
    (
      await request(
        JSON.stringify({
          action: "removed",
          installation: { id },
          repositories_removed: [{ id: 1 }],
        }),
        { "x-github-event": "installation_repositories" },
      )
    ).response.status,
  ).toBe(202);
  const registry = env.PROJECT_IDENTIFICATION_REGISTRY.getByName(String(id));
  expect(await registry.register(id, 1)).toBeNull();
  expect(await registry.register(id, 2)).not.toBeNull();
  expect(
    (await request("invalid", { "x-github-event": "installation" })).response
      .status,
  ).toBe(400);
  expect(
    (await request("{}", { "x-github-event": "installation" })).response.status,
  ).toBe(400);
  expect(
    (
      await request(
        JSON.stringify({ action: "created", installation: { id: 804 } }),
        { "x-github-event": "installation" },
      )
    ).response.status,
  ).toBe(202);
}, 15_000);
