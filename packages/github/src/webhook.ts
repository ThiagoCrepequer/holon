/// <reference lib="dom" />

import { webhookEnvelopeSchema, type WebhookEnvelope } from "@holon/contracts";
import { createDeliveryId } from "@holon/domain";
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
    },
    receivedAt,
    repository: {
      fullName: repository.full_name,
      id: repository.id,
      name: repository.name,
      owner: owner.login,
    },
    schemaVersion: 1,
  });
}
