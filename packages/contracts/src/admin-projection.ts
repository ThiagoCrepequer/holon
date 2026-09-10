import type { RunId } from "@holon/domain";
import { z } from "zod";

import { reviewScopeStatusSchema } from "./review-plan.js";
import { reviewVerdictSchema } from "./review-verdict.js";
import {
  gitShaSchema,
  positiveIntegerSchema,
  prKeySchema,
  runIdSchema,
  timestampSchema,
} from "./shared.js";

const nonNegativeSafeIntegerSchema = z.number().int().nonnegative().safe();
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const reviewPhaseReachedSchema = z.enum([
  "admitted",
  "repository_prepared",
  "analysis_started",
  "analyzed",
  "publishing",
]);

export type ReviewPhaseReached = z.infer<typeof reviewPhaseReachedSchema>;

export const adminRunProjectionPayloadSchema = z
  .strictObject({
    headSha: gitShaSchema,
    prKey: prKeySchema,
    projectedFrom: z.literal("workflow"),
    projectionRequestedAt: timestampSchema,
    pullRequestNumber: positiveIntegerSchema,
    repository: z.strictObject({
      id: positiveIntegerSchema,
      name: z.string().trim().min(1).max(100),
      owner: z.string().trim().min(1).max(100),
    }),
    reviewPhaseReached: reviewPhaseReachedSchema,
    runId: runIdSchema as z.ZodType<RunId>,
    scopeStatus: reviewScopeStatusSchema.nullable(),
    telemetry: z.strictObject({
      estimatedCostMicroUsd: nonNegativeSafeIntegerSchema,
      executionDurationMs: nonNegativeSafeIntegerSchema,
      inputTokens: nonNegativeSafeIntegerSchema,
      isDegraded: z.boolean(),
      outputTokens: nonNegativeSafeIntegerSchema,
      pricingModel: z.string().trim().min(1).max(100),
      reasoningTokens: nonNegativeSafeIntegerSchema.nullable(),
      reviewAdmissionQueueWaitMs: nonNegativeSafeIntegerSchema,
      shardsCount: nonNegativeSafeIntegerSchema,
      toolCallsCount: nonNegativeSafeIntegerSchema,
    }),
    terminalState: z.enum(["completed", "failed_terminal", "obsolete"]),
    timestamps: z.strictObject({
      analysisStartedAt: timestampSchema.nullable(),
      terminalAt: timestampSchema,
      webhookReceivedAt: timestampSchema,
      workflowStartedAt: timestampSchema,
    }),
    verdict: reviewVerdictSchema.nullable(),
  })
  .superRefine((payload, context) => {
    if (!payload.runId.startsWith(`${payload.prKey}:head:`)) {
      context.addIssue({
        code: "custom",
        message: "runId does not belong to prKey",
        path: ["runId"],
      });
    }
    if (!payload.runId.includes(`:head:${payload.headSha}:base:`)) {
      context.addIssue({
        code: "custom",
        message: "runId does not match headSha",
        path: ["headSha"],
      });
    }

    const webhookMs = Date.parse(payload.timestamps.webhookReceivedAt);
    const workflowMs = Date.parse(payload.timestamps.workflowStartedAt);
    const terminalMs = Date.parse(payload.timestamps.terminalAt);
    const projectionMs = Date.parse(payload.projectionRequestedAt);

    if (webhookMs > workflowMs) {
      context.addIssue({
        code: "custom",
        message: "webhookReceivedAt must be <= workflowStartedAt",
        path: ["timestamps", "webhookReceivedAt"],
      });
    }

    if (workflowMs > terminalMs) {
      context.addIssue({
        code: "custom",
        message: "workflowStartedAt must be <= terminalAt",
        path: ["timestamps", "workflowStartedAt"],
      });
    }

    if (payload.timestamps.analysisStartedAt !== null) {
      const analysisMs = Date.parse(payload.timestamps.analysisStartedAt);
      if (analysisMs < workflowMs || analysisMs > terminalMs) {
        context.addIssue({
          code: "custom",
          message:
            "analysisStartedAt must be between workflowStartedAt and terminalAt",
          path: ["timestamps", "analysisStartedAt"],
        });
      }
    }

    if (projectionMs < terminalMs) {
      context.addIssue({
        code: "custom",
        message: "projectionRequestedAt must be >= terminalAt",
        path: ["projectionRequestedAt"],
      });
    }
  });

export type AdminRunProjectionPayload = z.infer<
  typeof adminRunProjectionPayloadSchema
>;

export const adminRunProjectionEventSchema = z
  .strictObject({
    eventId: z.string().regex(/^proj:[a-f0-9]{64}$/u),
    payload: adminRunProjectionPayloadSchema,
    payloadHash: sha256Schema,
  })
  .superRefine((event, context) => {
    if (!event.payload.runId.startsWith(`${event.payload.prKey}:head:`)) {
      context.addIssue({
        code: "custom",
        message: "runId does not belong to prKey",
        path: ["payload", "runId"],
      });
    }
    if (!event.payload.runId.includes(`:head:${event.payload.headSha}:base:`)) {
      context.addIssue({
        code: "custom",
        message: "runId does not match headSha",
        path: ["payload", "headSha"],
      });
    }
  });

export type AdminRunProjectionEvent = z.infer<
  typeof adminRunProjectionEventSchema
>;

/**
 * Implements RFC 8785 (JSON Canonicalization Scheme).
 * Keys are lexicographically sorted by UTF-16 code units.
 * Whitespace is omitted.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null) {
    return "null";
  }

  const type = typeof value;

  if (type === "boolean") {
    return value ? "true" : "false";
  }

  if (type === "number") {
    const num = value as number;
    if (!Number.isFinite(num)) {
      throw new TypeError("Cannot canonicalize non-finite number");
    }
    if (Object.is(num, -0)) {
      return "0";
    }
    return JSON.stringify(num);
  }

  if (type === "string") {
    return JSON.stringify(value);
  }

  if (type === "bigint" || type === "symbol" || type === "function") {
    throw new TypeError(`Cannot canonicalize unsupported type: ${type}`);
  }

  if (value === undefined) {
    throw new TypeError("Cannot canonicalize undefined value");
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalizeJson(item));
    return `[${items.join(",")}]`;
  }

  if (type === "object") {
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record).toSorted();
    const parts: string[] = [];

    for (const key of sortedKeys) {
      const val = record[key];
      if (val === undefined) {
        throw new TypeError(
          `Cannot canonicalize object with undefined key: ${key}`,
        );
      }
      parts.push(`${JSON.stringify(key)}:${canonicalizeJson(val)}`);
    }

    return `{${parts.join(",")}}`;
  }

  throw new TypeError("Unsupported value for canonicalization");
}

/**
 * Computes SHA-256 in hexadecimal format using standard Web Crypto.
 */
export async function computeSha256Hex(
  data: string | Uint8Array,
): Promise<string> {
  const buffer =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : Uint8Array.from(data);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Builds and validates an immutable AdminRunProjectionEvent.
 */
export async function buildAdminProjectionEvent(
  payloadInput: unknown,
): Promise<AdminRunProjectionEvent> {
  const payload = adminRunProjectionPayloadSchema.parse(payloadInput);
  const canonicalPayload = canonicalizeJson(payload);
  const payloadHash = await computeSha256Hex(canonicalPayload);
  const runIdHash = await computeSha256Hex(payload.runId);
  const eventId = `proj:${runIdHash}`;

  return adminRunProjectionEventSchema.parse({
    eventId,
    payload,
    payloadHash,
  });
}
