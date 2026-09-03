/// <reference lib="dom" />

import { webhookEnvelopeSchema, type WebhookEnvelope } from "@holon/contracts";
import { createDeliveryId, type DeliveryId } from "@holon/domain";
import type { operations } from "@octokit/openapi-webhooks-types";

export type GitHubPullRequestWebhook =
  | operations["pull-request/opened"]["requestBody"]["content"]["application/json"]
  | operations["pull-request/reopened"]["requestBody"]["content"]["application/json"]
  | operations["pull-request/synchronize"]["requestBody"]["content"]["application/json"];

const signaturePattern = /^sha256=([a-f0-9]{64})$/u;

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/gu) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
}

export async function verifyWebhookSignature(
  secret: string,
  rawBody: string | Uint8Array,
  signature: string,
): Promise<boolean> {
  const match = signaturePattern.exec(signature);
  if (match?.[1] === undefined || secret.length === 0) return false;
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["verify"],
  );
  const body =
    typeof rawBody === "string"
      ? new TextEncoder().encode(rawBody)
      : Uint8Array.from(rawBody);
  return globalThis.crypto.subtle.verify(
    "HMAC",
    key,
    hexToBytes(match[1]) as Uint8Array<ArrayBuffer>,
    body,
  );
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function mapPullRequestWebhook(
  payload: unknown,
  deliveryId: string,
  receivedAt: string,
): WebhookEnvelope {
  const root = record(payload, "payload");
  const installation = record(root.installation, "installation");
  const pullRequest = record(root.pull_request, "pull_request");
  const base = record(pullRequest.base, "pull_request.base");
  const head = record(pullRequest.head, "pull_request.head");
  const repository = record(root.repository, "repository");
  const owner = record(repository.owner, "repository.owner");

  return webhookEnvelopeSchema.parse({
    action: root.action,
    deliveryId: createDeliveryId(deliveryId),
    event: "pull_request",
    installationId: installation.id,
    pullRequest: {
      baseSha: base.sha,
      headSha: head.sha,
      number: root.number,
      updatedAt: pullRequest.updated_at,
    },
    receivedAt,
    repository: {
      fullName: repository.full_name,
      id: repository.id,
      name: repository.name,
      owner: owner.login,
    },
    schemaVersion: 2,
  });
}

export interface ReviewCommentWebhookEvent {
  readonly action: string;
  readonly authorAssociation?: string | undefined;
  readonly authorLogin: string;
  readonly body: string;
  readonly commentId: number;
  readonly createdAt: string;
  readonly deliveryId: DeliveryId;
  readonly inReplyToId?: number | undefined;
  readonly installationId: number;
  readonly pullRequestNumber: number;
  readonly repository: {
    readonly fullName: string;
    readonly id: number;
    readonly name: string;
    readonly owner: string;
  };
}

export function mapReviewCommentWebhook(
  payload: unknown,
  deliveryId: string,
): ReviewCommentWebhookEvent {
  const root = record(payload, "payload");
  const comment = record(root.comment, "comment");
  const user = record(comment.user, "comment.user");
  const pullRequest = record(root.pull_request, "pull_request");
  const repository = record(root.repository, "repository");
  const owner = record(repository.owner, "repository.owner");
  const installation = record(root.installation, "installation");

  const inReplyToId =
    typeof comment.in_reply_to_id === "number"
      ? comment.in_reply_to_id
      : undefined;

  const authorAssociation =
    typeof comment.author_association === "string"
      ? comment.author_association
      : undefined;

  return {
    action: String(root.action),
    authorAssociation,
    authorLogin: String(user.login),
    body: String(comment.body),
    commentId: Number(comment.id),
    createdAt: String(comment.created_at),
    deliveryId: createDeliveryId(deliveryId),
    inReplyToId,
    installationId: Number(installation.id),
    pullRequestNumber: Number(pullRequest.number),
    repository: {
      fullName: String(repository.full_name),
      id: Number(repository.id),
      name: String(repository.name),
      owner: String(owner.login),
    },
  };
}

export interface ReviewThreadWebhookEvent {
  readonly action: "resolved" | "unresolved";
  readonly authorLogin: string;
  readonly deliveryId: DeliveryId;
  readonly installationId: number;
  readonly pullRequestNumber: number;
  readonly repository: {
    readonly fullName: string;
    readonly id: number;
    readonly name: string;
    readonly owner: string;
  };
  readonly rootCommentId: number;
}

export function mapReviewThreadWebhook(
  payload: unknown,
  deliveryId: string,
): ReviewThreadWebhookEvent {
  const root = record(payload, "payload");
  const thread = record(root.thread, "thread");
  const comments = Array.isArray(thread.comments) ? thread.comments : [];
  if (comments.length === 0) {
    throw new TypeError("thread.comments must contain at least one comment");
  }
  const rootComment = record(comments[0], "thread.comments[0]");
  const pullRequest = record(root.pull_request, "pull_request");
  const repository = record(root.repository, "repository");
  const owner = record(repository.owner, "repository.owner");
  const sender = record(root.sender, "sender");
  const installation = record(root.installation, "installation");

  return {
    action: root.action === "resolved" ? "resolved" : "unresolved",
    authorLogin: String(sender.login),
    deliveryId: createDeliveryId(deliveryId),
    installationId: Number(installation.id),
    pullRequestNumber: Number(pullRequest.number),
    repository: {
      fullName: String(repository.full_name),
      id: Number(repository.id),
      name: String(repository.name),
      owner: String(owner.login),
    },
    rootCommentId: Number(rootComment.id),
  };
}
