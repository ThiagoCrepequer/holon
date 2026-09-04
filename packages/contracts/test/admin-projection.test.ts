import { describe, expect, it } from "vitest";

import {
  adminRunProjectionEventV1Schema,
  adminRunProjectionPayloadV1Schema,
  buildAdminProjectionEventV1,
  canonicalizeJson,
  computeSha256Hex,
  type AdminRunProjectionPayloadV1,
} from "../src/index.js";

const sha = "a".repeat(40);
const prKey = "github:42:pr:7" as const;
const runId = `${prKey}:head:${sha}` as const;

const validPayload: AdminRunProjectionPayloadV1 = {
  headSha: sha,
  prKey,
  projectedFrom: "workflow",
  projectionRequestedAt: "2026-09-04T12:00:10.000Z",
  pullRequestNumber: 7,
  recordVersion: 1,
  repository: {
    id: 42,
    name: "holon",
    owner: "ThiagoCrepequer",
  },
  reviewPhaseReached: "publishing",
  runId,
  schemaVersion: 1,
  scopeStatus: "complete",
  telemetry: {
    estimatedCostMicroUsd: 12500,
    executionDurationMs: 4200,
    inputTokens: 3000,
    isDegraded: false,
    outputTokens: 500,
    pricingModel: "openrouter/anthropic/claude-3.5-sonnet",
    reasoningTokens: null,
    reviewAdmissionQueueWaitMs: 150,
    shardsCount: 1,
    toolCallsCount: 4,
  },
  terminalState: "completed",
  timestamps: {
    analysisStartedAt: "2026-09-04T12:00:02.000Z",
    terminalAt: "2026-09-04T12:00:08.000Z",
    webhookReceivedAt: "2026-09-04T12:00:00.000Z",
    workflowStartedAt: "2026-09-04T12:00:01.000Z",
  },
  verdict: "APPROVE",
};

describe("admin projection v1 contract", () => {
  it("validates a complete valid payload", () => {
    const parsed = adminRunProjectionPayloadV1Schema.parse(validPayload);
    expect(parsed).toEqual(validPayload);
  });

  it("accepts early obsolete run with null scopeStatus, verdict and analysisStartedAt", () => {
    const obsoletePayload: AdminRunProjectionPayloadV1 = {
      ...validPayload,
      reviewPhaseReached: "admitted",
      scopeStatus: null,
      terminalState: "obsolete",
      timestamps: {
        ...validPayload.timestamps,
        analysisStartedAt: null,
      },
      verdict: null,
    };
    const parsed = adminRunProjectionPayloadV1Schema.parse(obsoletePayload);
    expect(parsed.scopeStatus).toBeNull();
    expect(parsed.verdict).toBeNull();
    expect(parsed.timestamps.analysisStartedAt).toBeNull();
  });

  it("rejects runId mismatching prKey", () => {
    const invalid = {
      ...validPayload,
      runId: `github:99:pr:7:head:${sha}`,
    };
    expect(() => adminRunProjectionPayloadV1Schema.parse(invalid)).toThrow(
      /runId does not belong to prKey/u,
    );
  });

  it("rejects runId mismatching headSha", () => {
    const otherSha = "b".repeat(40);
    const invalid = {
      ...validPayload,
      headSha: otherSha,
    };
    expect(() => adminRunProjectionPayloadV1Schema.parse(invalid)).toThrow(
      /runId does not match headSha/u,
    );
  });

  describe("temporal ordering validation", () => {
    it("rejects webhookReceivedAt > workflowStartedAt", () => {
      const invalid = {
        ...validPayload,
        timestamps: {
          ...validPayload.timestamps,
          webhookReceivedAt: "2026-09-04T12:00:05.000Z",
          workflowStartedAt: "2026-09-04T12:00:01.000Z",
        },
      };
      expect(() => adminRunProjectionPayloadV1Schema.parse(invalid)).toThrow(
        /webhookReceivedAt must be <= workflowStartedAt/u,
      );
    });

    it("rejects workflowStartedAt > terminalAt", () => {
      const invalid = {
        ...validPayload,
        timestamps: {
          ...validPayload.timestamps,
          terminalAt: "2026-09-04T12:00:00.000Z",
          workflowStartedAt: "2026-09-04T12:00:01.000Z",
        },
      };
      expect(() => adminRunProjectionPayloadV1Schema.parse(invalid)).toThrow(
        /workflowStartedAt must be <= terminalAt/u,
      );
    });

    it("rejects analysisStartedAt earlier than workflowStartedAt", () => {
      const invalid = {
        ...validPayload,
        timestamps: {
          ...validPayload.timestamps,
          analysisStartedAt: "2026-09-04T12:00:00.500Z",
          workflowStartedAt: "2026-09-04T12:00:01.000Z",
        },
      };
      expect(() => adminRunProjectionPayloadV1Schema.parse(invalid)).toThrow(
        /analysisStartedAt must be between workflowStartedAt and terminalAt/u,
      );
    });

    it("rejects analysisStartedAt later than terminalAt", () => {
      const invalid = {
        ...validPayload,
        timestamps: {
          ...validPayload.timestamps,
          analysisStartedAt: "2026-09-04T12:00:09.000Z",
          terminalAt: "2026-09-04T12:00:08.000Z",
        },
      };
      expect(() => adminRunProjectionPayloadV1Schema.parse(invalid)).toThrow(
        /analysisStartedAt must be between workflowStartedAt and terminalAt/u,
      );
    });

    it("rejects projectionRequestedAt earlier than terminalAt", () => {
      const invalid = {
        ...validPayload,
        projectionRequestedAt: "2026-09-04T12:00:07.000Z",
        timestamps: {
          ...validPayload.timestamps,
          terminalAt: "2026-09-04T12:00:08.000Z",
        },
      };
      expect(() => adminRunProjectionPayloadV1Schema.parse(invalid)).toThrow(
        /projectionRequestedAt must be >= terminalAt/u,
      );
    });
  });
});

describe("canonicalizeJson and buildAdminProjectionEventV1", () => {
  it("canonicalizes JSON with sorted keys independent of insertion order", () => {
    const objA = { z: 1, a: 2, m: { y: "test", b: false } };
    const objB = { m: { b: false, y: "test" }, a: 2, z: 1 };
    expect(canonicalizeJson(objA)).toBe(
      '{"a":2,"m":{"b":false,"y":"test"},"z":1}',
    );
    expect(canonicalizeJson(objA)).toBe(canonicalizeJson(objB));
  });

  it("handles Unicode characters and emojis safely", () => {
    const unicodeObj = { café: "delícia", emoji: "🚀", latin: "a" };
    const canonical = canonicalizeJson(unicodeObj);
    expect(canonical).toBe('{"café":"delícia","emoji":"🚀","latin":"a"}');
  });

  it("preserves array ordering strictly", () => {
    const arrObj = { list: [3, 1, 2, "z", "a"] };
    expect(canonicalizeJson(arrObj)).toBe('{"list":[3,1,2,"z","a"]}');
  });

  it("rejects undefined, NaN, Infinity and bigints", () => {
    expect(() => canonicalizeJson({ invalid: undefined })).toThrow();
    expect(() => canonicalizeJson({ invalid: Number.NaN })).toThrow();
    expect(() =>
      canonicalizeJson({ invalid: Number.POSITIVE_INFINITY }),
    ).toThrow();
    expect(() => canonicalizeJson({ invalid: 42n })).toThrow();
  });

  it("builds a canonical event with deterministic eventId and payloadHash", async () => {
    const event = await buildAdminProjectionEventV1(validPayload);
    const expectedRunIdHash = await computeSha256Hex(validPayload.runId);
    expect(event.eventId).toBe(`proj:v1:${expectedRunIdHash}:1`);

    const canonicalPayload = canonicalizeJson(validPayload);
    const expectedPayloadHash = await computeSha256Hex(canonicalPayload);
    expect(event.payloadHash).toBe(expectedPayloadHash);

    // Envelope validates under schema
    const parsedEnvelope = adminRunProjectionEventV1Schema.parse(event);
    expect(parsedEnvelope.eventId).toBe(event.eventId);
    expect(parsedEnvelope.payloadHash).toBe(event.payloadHash);
  });

  it("produces identical event for same payload with permuted object keys", async () => {
    const permutedPayload = JSON.parse(JSON.stringify(validPayload));
    // Reinsert keys in different order
    const reordered: Record<string, unknown> = {};
    for (const key of Object.keys(permutedPayload).toReversed()) {
      reordered[key] = permutedPayload[key];
    }

    const event1 = await buildAdminProjectionEventV1(validPayload);
    const event2 = await buildAdminProjectionEventV1(reordered);
    expect(event1.eventId).toBe(event2.eventId);
    expect(event1.payloadHash).toBe(event2.payloadHash);
  });
});
