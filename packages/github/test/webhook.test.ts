/// <reference lib="dom" />

import { describe, expect, it } from "vitest";

import {
  mapPullRequestWebhook,
  mapReviewCommentWebhook,
  mapReviewThreadWebhook,
  verifyWebhookSignature,
} from "../src/index.js";

const payload = JSON.stringify({ action: "opened" });

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  return `sha256=${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

describe("GitHub webhook boundary", () => {
  it("verifies the signature against the exact raw body", async () => {
    const signature = await sign("top-secret", payload);
    await expect(
      verifyWebhookSignature("top-secret", payload, signature),
    ).resolves.toBe(true);
    await expect(
      verifyWebhookSignature("top-secret", `${payload}\n`, signature),
    ).resolves.toBe(false);
    await expect(
      verifyWebhookSignature(
        "top-secret",
        new TextEncoder().encode(payload),
        signature,
      ),
    ).resolves.toBe(true);
  });

  it.each(["", "sha1=abc", "sha256=not-hex", `sha256=${"a".repeat(63)}`])(
    "rejects malformed signature %j",
    async (signature) => {
      await expect(
        verifyWebhookSignature("top-secret", payload, signature),
      ).resolves.toBe(false);
    },
  );

  it("maps only the minimal pull request data into the queue envelope", () => {
    const envelope = mapPullRequestWebhook(
      {
        action: "opened",
        installation: { id: 99 },
        number: 7,
        pull_request: {
          base: { sha: "b".repeat(40) },
          head: { sha: "a".repeat(40) },
          updated_at: "2026-08-29T11:59:59.000Z",
        },
        repository: {
          full_name: "acme/api",
          id: 42,
          name: "api",
          owner: { login: "acme" },
        },
      },
      "delivery-123",
      "2026-08-29T12:00:00.000Z",
    );

    expect(envelope).toEqual({
      action: "opened",
      deliveryId: "github:delivery-123",
      event: "pull_request",
      installationId: 99,
      pullRequest: {
        baseSha: "b".repeat(40),
        headSha: "a".repeat(40),
        number: 7,
        updatedAt: "2026-08-29T11:59:59.000Z",
      },
      receivedAt: "2026-08-29T12:00:00.000Z",
      repository: { fullName: "acme/api", id: 42, name: "api", owner: "acme" },
      schemaVersion: 2,
    });
    expect(envelope).not.toHaveProperty("sender");
  });

  it("rejects malformed payloads before queueing", () => {
    expect(() =>
      mapPullRequestWebhook(
        { action: "closed" },
        "delivery-123",
        "2026-08-29T12:00:00.000Z",
      ),
    ).toThrow();
  });

  it("maps pull_request_review_comment payloads into ReviewCommentWebhookEvent", () => {
    const commentPayload = {
      action: "created",
      comment: {
        author_association: "COLLABORATOR",
        body: "/holon dismiss false-positive",
        created_at: "2026-09-02T10:00:00.000Z",
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

    const event = mapReviewCommentWebhook(commentPayload, "del-123");
    expect(event).toEqual({
      action: "created",
      authorAssociation: "COLLABORATOR",
      authorLogin: "alice",
      body: "/holon dismiss false-positive",
      commentId: 12345,
      createdAt: "2026-09-02T10:00:00.000Z",
      deliveryId: "github:del-123",
      inReplyToId: 101,
      installationId: 99,
      pullRequestNumber: 7,
      repository: {
        fullName: "acme/api",
        id: 42,
        name: "api",
        owner: "acme",
      },
    });
  });

  it("maps pull_request_review_thread payloads into ReviewThreadWebhookEvent", () => {
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
      sender: { author_association: "MEMBER", login: "bob" },
      thread: {
        comments: [{ id: 101 }],
      },
    };

    const event = mapReviewThreadWebhook(threadPayload, "del-456");
    expect(event).toEqual({
      action: "resolved",
      authorAssociation: "MEMBER",
      authorLogin: "bob",
      deliveryId: "github:del-456",
      installationId: 99,
      pullRequestNumber: 7,
      repository: {
        fullName: "acme/api",
        id: 42,
        name: "api",
        owner: "acme",
      },
      rootCommentId: 101,
    });
  });
});
