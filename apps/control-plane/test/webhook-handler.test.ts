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
      schemaVersion: 1,
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
});
