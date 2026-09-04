import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { D1AdminStorage } from "../workers/d1-adapter.js";
import { processAdminProjectionBatch } from "../workers/queue-consumer.js";
import { createSampleProjectionEvent, setupTestDatabase } from "./helpers.js";

interface MockMessage<T> extends Message<T> {
  ackMock: Mock;
  retryMock: Mock;
}

function createMockMessage<T>(body: T): MockMessage<T> {
  const ackMock = vi.fn();
  const retryMock = vi.fn();
  return {
    ack: ackMock,
    ackMock,
    attempts: 1,
    body,
    id: "msg-" + Math.random().toString(36).substring(7),
    retry: retryMock,
    retryMock,
    timestamp: new Date(),
  };
}

function createMockBatch<T>(messages: Message<T>[]): MessageBatch<T> {
  return {
    ackAll: vi.fn(),
    messages,
    metadata: {
      metrics: {
        backlogBytes: 0,
        backlogCount: 0,
      },
    },
    queue: "holon-admin-projections",
    retryAll: vi.fn(),
  };
}

describe("processAdminProjectionBatch", () => {
  let storage: D1AdminStorage;

  beforeEach(async () => {
    await setupTestDatabase(env.DB);
    storage = new D1AdminStorage(env.DB);
  });

  it("processes valid projection event batch successfully", async () => {
    const event = await createSampleProjectionEvent();
    const msg = createMockMessage(event);
    const batch = createMockBatch([msg]);

    const result = await processAdminProjectionBatch(batch, storage);
    expect(result).toEqual({ acknowledged: 1, quarantined: 0, retried: 0 });
    expect(msg.ackMock).toHaveBeenCalled();
    expect(msg.retryMock).not.toHaveBeenCalled();

    const stored = await storage.getRunById(event.payload.runId);
    expect(stored).not.toBeNull();
  });

  it("acks exact duplicate message idempotently", async () => {
    const event = await createSampleProjectionEvent();
    await storage.insertProjection(event);

    const msg = createMockMessage(event);
    const batch = createMockBatch([msg]);

    const result = await processAdminProjectionBatch(batch, storage);
    expect(result).toEqual({ acknowledged: 1, quarantined: 0, retried: 0 });
    expect(msg.ackMock).toHaveBeenCalled();
  });

  it("quarantines message with invalid schema and acks to prevent redelivery loop", async () => {
    const invalidBody = {
      eventId: "evt-bad",
      occurredAt: "not-a-date",
      payload: { something: "unknown" },
      schemaVersion: 999,
    };
    const msg = createMockMessage(invalidBody);
    const batch = createMockBatch([msg]);

    const result = await processAdminProjectionBatch(batch, storage);
    expect(result).toEqual({ acknowledged: 0, quarantined: 1, retried: 0 });
    expect(msg.ackMock).toHaveBeenCalled();

    const quarantined = await storage.getQuarantined(10);
    expect(quarantined.length).toBe(1);
    expect(quarantined[0]?.error_code).toBe("INVALID_EVENT_SCHEMA");
  });

  it("quarantines message with corrupted payload hash (HASH_MISMATCH) and acks", async () => {
    const event = await createSampleProjectionEvent();
    const tampered = {
      ...event,
      payloadHash: "0".repeat(64),
    };

    const msg = createMockMessage(tampered);
    const batch = createMockBatch([msg]);

    const result = await processAdminProjectionBatch(batch, storage);
    expect(result).toEqual({ acknowledged: 0, quarantined: 1, retried: 0 });
    expect(msg.ackMock).toHaveBeenCalled();

    const quarantined = await storage.getQuarantined(10);
    expect(quarantined.length).toBe(1);
    expect(quarantined[0]?.error_code).toBe("HASH_MISMATCH");
  });

  it("quarantines divergent payload conflict (IMMUTABLE_RUN_CONFLICT) and acks", async () => {
    const event1 = await createSampleProjectionEvent({
      verdict: "APPROVE",
    });
    await storage.insertProjection(event1);

    const event2 = await createSampleProjectionEvent({
      verdict: "REQUEST_CHANGES",
    });
    const msg = createMockMessage(event2);
    const batch = createMockBatch([msg]);

    const result = await processAdminProjectionBatch(batch, storage);
    expect(result).toEqual({ acknowledged: 0, quarantined: 1, retried: 0 });
    expect(msg.ackMock).toHaveBeenCalled();

    const quarantined = await storage.getQuarantined(10);
    expect(quarantined.length).toBe(1);
    expect(quarantined[0]?.error_code).toBe("IMMUTABLE_RUN_CONFLICT");
  });

  it("retries message when storage throws unexpected database error", async () => {
    const event = await createSampleProjectionEvent();
    const msg = createMockMessage(event);
    const batch = createMockBatch([msg]);

    const failingStorage = {
      insertProjection: vi
        .fn()
        .mockRejectedValue(new Error("D1 connection lost")),
      quarantine: vi.fn(),
    } as unknown as D1AdminStorage;

    const result = await processAdminProjectionBatch(batch, failingStorage);
    expect(result).toEqual({ acknowledged: 0, quarantined: 0, retried: 1 });
    expect(msg.retryMock).toHaveBeenCalled();
    expect(msg.ackMock).not.toHaveBeenCalled();
  });

  it("quarantines event_id_collision and acks", async () => {
    const quarantineMock = vi.fn().mockResolvedValue(undefined);
    const mockStorage = {
      insertProjection: vi
        .fn()
        .mockResolvedValue({ status: "event_id_collision" }),
      quarantine: quarantineMock,
    } as unknown as D1AdminStorage;

    const event = await createSampleProjectionEvent();
    const msg = createMockMessage(event);
    const batch = createMockBatch([msg]);

    const result = await processAdminProjectionBatch(batch, mockStorage);
    expect(result).toEqual({ acknowledged: 0, quarantined: 1, retried: 0 });
    expect(msg.ackMock).toHaveBeenCalled();
    expect(quarantineMock).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "EVENT_ID_COLLISION" }),
    );
  });

  it("handles string error bodies and missing properties in malformed messages", async () => {
    const msg = createMockMessage("not json at all");
    const batch = createMockBatch([msg]);

    const result = await processAdminProjectionBatch(batch, storage);
    expect(result).toEqual({ acknowledged: 0, quarantined: 1, retried: 0 });
    expect(msg.ackMock).toHaveBeenCalled();
  });

  it("handles object with non-string properties in malformed messages", async () => {
    const msg = createMockMessage({
      eventId: 123,
      payload: { runId: 456 },
      schemaVersion: "one",
    });
    const batch = createMockBatch([msg]);

    const result = await processAdminProjectionBatch(batch, storage);
    expect(result).toEqual({ acknowledged: 0, quarantined: 1, retried: 0 });
    expect(msg.ackMock).toHaveBeenCalled();
  });
});
