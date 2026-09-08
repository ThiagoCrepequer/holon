import {
  adminRunProjectionEventSchema,
  canonicalizeJson,
  computeSha256Hex,
} from "@holon/contracts";

import type { D1AdminStorage } from "./d1-adapter.js";

export interface QueueProcessingSummary {
  acknowledged: number;
  retried: number;
  quarantined: number;
}

export async function processAdminProjectionBatch(
  batch: MessageBatch<unknown>,
  storage: D1AdminStorage,
  options?: { now?: () => number },
): Promise<QueueProcessingSummary> {
  let acknowledged = 0;
  let retried = 0;
  let quarantined = 0;

  for (const message of batch.messages) {
    try {
      const parseResult = adminRunProjectionEventSchema.safeParse(message.body);
      if (!parseResult.success) {
        const rawString =
          typeof message.body === "string"
            ? message.body
            : JSON.stringify(message.body ?? null);
        const bytes = new TextEncoder().encode(rawString).byteLength;
        const payloadHash = await computeSha256Hex(rawString);

        const bodyObj =
          typeof message.body === "object" && message.body !== null
            ? (message.body as Record<string, unknown>)
            : {};
        const observedEventId =
          typeof bodyObj.eventId === "string" ? bodyObj.eventId : null;
        const payloadObj =
          typeof bodyObj.payload === "object" && bodyObj.payload !== null
            ? (bodyObj.payload as Record<string, unknown>)
            : {};
        const observedRunId =
          typeof payloadObj.runId === "string" ? payloadObj.runId : null;

        await storage.quarantine({
          observedEventId,
          observedRunId,
          computedPayloadHash: payloadHash,
          payloadBytes: bytes,
          errorCode: "INVALID_EVENT_SCHEMA",
          nowEpochMs: options?.now?.(),
        });

        message.ack();
        quarantined++;
        continue;
      }

      const event = parseResult.data;
      const canonicalPayload = canonicalizeJson(event.payload);
      const computedHash = await computeSha256Hex(canonicalPayload);

      if (computedHash !== event.payloadHash) {
        const bytes = new TextEncoder().encode(canonicalPayload).byteLength;
        await storage.quarantine({
          errorCode: "HASH_MISMATCH",
          nowEpochMs: options?.now?.(),
          observedEventId: event.eventId,
          observedRunId: event.payload.runId,
          payloadBytes: bytes,
          computedPayloadHash: computedHash,
        });

        message.ack();
        quarantined++;
        continue;
      }

      const insertResult = await storage.insertProjection(
        event,
        options?.now?.(),
      );
      if (
        insertResult.status === "inserted" ||
        insertResult.status === "duplicate"
      ) {
        message.ack();
        acknowledged++;
        continue;
      }

      if (insertResult.status === "conflict") {
        const bytes = new TextEncoder().encode(canonicalPayload).byteLength;
        await storage.quarantine({
          errorCode: "IMMUTABLE_RUN_CONFLICT",
          nowEpochMs: options?.now?.(),
          observedEventId: event.eventId,
          observedRunId: event.payload.runId,
          payloadBytes: bytes,
          computedPayloadHash: event.payloadHash,
        });

        message.ack();
        quarantined++;
        continue;
      }

      if (insertResult.status === "event_id_collision") {
        const bytes = new TextEncoder().encode(canonicalPayload).byteLength;
        await storage.quarantine({
          errorCode: "EVENT_ID_COLLISION",
          nowEpochMs: options?.now?.(),
          observedEventId: event.eventId,
          observedRunId: event.payload.runId,
          payloadBytes: bytes,
          computedPayloadHash: event.payloadHash,
        });

        message.ack();
        quarantined++;
        continue;
      }
    } catch {
      message.retry();
      retried++;
    }
  }

  return { acknowledged, retried, quarantined };
}
