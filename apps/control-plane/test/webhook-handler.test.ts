import type { HealthCheckReport } from "@holon/contracts";
import { describe, expect, it } from "vitest";

import {
  createWebhookApp,
  readBoundedRequestBody,
} from "../src/webhook-handler.js";

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
      GITHUB_APP_ID: "123",
      GITHUB_APP_PRIVATE_KEY: "fake-key",
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
      schemaVersion: 2,
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

  it("handles workflow_run events appropriately", async () => {
    // Ignored if action is not completed
    const inProgressResult = await request(
      JSON.stringify({ action: "in_progress", workflow_run: {} }),
      { "x-github-event": "workflow_run" },
    );
    expect(inProgressResult.response.status).toBe(202);
    await expect(inProgressResult.response.json()).resolves.toEqual({
      accepted: true,
      ignored: true,
    });

    // Ignored if workflow_run has no pull requests
    const noPrResult = await request(
      JSON.stringify({
        action: "completed",
        installation: { id: 99 },
        repository: { id: 42, name: "api", owner: { login: "acme" } },
        workflow_run: {
          head_sha: "a".repeat(40),
          id: 12345,
          name: "ci",
          pull_requests: [],
        },
      }),
      { "x-github-event": "workflow_run" },
    );
    expect(noPrResult.response.status).toBe(202);
    await expect(noPrResult.response.json()).resolves.toEqual({
      accepted: true,
      ignored: true,
    });

    // Enriched when valid completed workflow_run arrives
    const completedResult = await request(
      JSON.stringify({
        action: "completed",
        installation: { id: 99 },
        repository: { id: 42, name: "api", owner: { login: "acme" } },
        workflow_run: {
          head_sha: "a".repeat(40),
          id: 12345,
          name: "ci",
          pull_requests: [{ number: 7 }],
        },
      }),
      { "x-github-event": "workflow_run" },
    );
    expect(completedResult.response.status).toBe(202);
    await expect(completedResult.response.json()).resolves.toMatchObject({
      accepted: true,
      deliveryId: "delivery-123",
      enriched: true,
    });

    // Ignored when PR number is invalid
    const invalidPrNum = await request(
      JSON.stringify({
        action: "completed",
        installation: { id: 99 },
        repository: { id: 42, name: "api", owner: { login: "acme" } },
        workflow_run: {
          head_sha: "a".repeat(40),
          id: 12345,
          pull_requests: [{ number: "invalid" }],
        },
      }),
      { "x-github-event": "workflow_run" },
    );
    expect(invalidPrNum.response.status).toBe(202);

    // Ignored when head_sha is missing
    const missingHeadSha = await request(
      JSON.stringify({
        action: "completed",
        installation: { id: 99 },
        repository: { id: 42, name: "api", owner: { login: "acme" } },
        workflow_run: {
          id: 12345,
          pull_requests: [{ number: 7 }],
        },
      }),
      { "x-github-event": "workflow_run" },
    );
    expect(missingHeadSha.response.status).toBe(202);
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

    // Fully operational healthcheck
    const resHealthy = await app.request(
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
