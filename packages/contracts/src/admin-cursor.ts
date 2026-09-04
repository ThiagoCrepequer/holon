import { z } from "zod";

import { canonicalizeJson, computeSha256Hex } from "./admin-projection.js";
import { runIdSchema } from "./shared.js";

export const adminCursorPayloadSchema = z.strictObject({
  filterHash: z.string().regex(/^[a-f0-9]{64}$/u),
  issuedAtEpochMs: z.number().int().positive(),
  kid: z.string().min(1).max(100),
  runId: runIdSchema,
  terminalAtEpochMs: z.number().int().positive(),
  v: z.literal(1),
});

export type AdminCursorPayload = z.infer<typeof adminCursorPayloadSchema>;

export const cursorKeyEntrySchema = z.strictObject({
  kid: z.string().min(1).max(100),
  secretHex: z.string().regex(/^[a-f0-9]{64}$/iu),
});

export const cursorKeyringSchema = z.strictObject({
  primary: cursorKeyEntrySchema,
  secondary: cursorKeyEntrySchema.optional(),
});

export type CursorKeyEntry = z.infer<typeof cursorKeyEntrySchema>;
export type CursorKeyring = z.infer<typeof cursorKeyringSchema>;

export const adminRunsFilterParamsSchema = z.strictObject({
  order: z.enum(["desc", "asc"]).default("desc"),
  pageSize: z.union([z.literal(20), z.literal(50), z.literal(100)]).default(50),
  period: z.enum(["24h", "7d", "30d"]).default("24h"),
  repositoryId: z.number().int().positive().optional(),
  searchQuery: z.string().trim().min(1).max(200).optional(),
  terminalState: z
    .enum(["completed", "failed_terminal", "obsolete"])
    .optional(),
  verdict: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]).optional(),
});

export type AdminRunsFilterParams = z.infer<typeof adminRunsFilterParamsSchema>;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replaceAll("-", "+").replaceAll("_", "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.trim().toLowerCase();
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function importHmacKey(secretHex: string): Promise<CryptoKey> {
  const rawKey = hexToBytes(secretHex) as Uint8Array<ArrayBuffer>;
  return globalThis.crypto.subtle.importKey(
    "raw",
    rawKey,
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"],
  );
}

/**
 * Computes a deterministic SHA-256 hash for query filter parameters.
 */
export async function computeFilterHash(
  filters: Partial<AdminRunsFilterParams>,
): Promise<string> {
  const normalized = adminRunsFilterParamsSchema.parse(filters);
  const canonical = canonicalizeJson(normalized);
  return computeSha256Hex(canonical);
}

/**
 * Encodes and HMAC signs an opaque keyset cursor token.
 */
export async function encodeAdminCursor(
  payloadInput: {
    filterHash: string;
    runId: string;
    terminalAtEpochMs: number;
  },
  keyringInput: unknown,
  nowEpochMs = Date.now(),
): Promise<string> {
  const keyring = cursorKeyringSchema.parse(keyringInput);
  const rawPayload = {
    filterHash: payloadInput.filterHash,
    issuedAtEpochMs: nowEpochMs,
    kid: keyring.primary.kid,
    runId: payloadInput.runId,
    terminalAtEpochMs: payloadInput.terminalAtEpochMs,
    v: 1,
  };

  const payload = adminCursorPayloadSchema.parse(rawPayload);
  const canonicalPayload = canonicalizeJson(payload);
  const payloadBytes = new TextEncoder().encode(canonicalPayload);

  const key = await importHmacKey(keyring.primary.secretHex);
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    payloadBytes,
  );

  const payloadPart = base64UrlEncode(payloadBytes);
  const signaturePart = base64UrlEncode(new Uint8Array(signature));

  return `${payloadPart}.${signaturePart}`;
}

const DEFAULT_MAX_CURSOR_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Decodes, verifies signature, validates TTL and checks filterHash.
 * Throws Error on any validation failure.
 */
export async function decodeAdminCursor(
  cursorToken: string,
  expectedFilterHash: string,
  keyringInput: unknown,
  nowEpochMs = Date.now(),
  maxAgeMs = DEFAULT_MAX_CURSOR_AGE_MS,
): Promise<AdminCursorPayload> {
  const keyring = cursorKeyringSchema.parse(keyringInput);

  if (typeof cursorToken !== "string" || !cursorToken.includes(".")) {
    throw new Error("Invalid cursor format");
  }

  const parts = cursorToken.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Invalid cursor token parts");
  }

  let payloadBytes: Uint8Array;
  let signatureBytes: Uint8Array;
  try {
    payloadBytes = base64UrlDecode(parts[0]);
    signatureBytes = base64UrlDecode(parts[1]);
  } catch {
    throw new Error("Invalid cursor encoding");
  }

  let rawJson: unknown;
  try {
    const text = new TextDecoder().decode(payloadBytes);
    rawJson = JSON.parse(text);
  } catch {
    throw new Error("Invalid cursor JSON");
  }

  const payload = adminCursorPayloadSchema.parse(rawJson);

  // Check expiration
  if (
    nowEpochMs < payload.issuedAtEpochMs ||
    nowEpochMs - payload.issuedAtEpochMs > maxAgeMs
  ) {
    throw new Error("Cursor expired");
  }

  // Check filterHash match
  if (payload.filterHash !== expectedFilterHash) {
    throw new Error("Cursor filter mismatch");
  }

  // Find key by kid
  let matchingKeyEntry: CursorKeyEntry | undefined;
  if (payload.kid === keyring.primary.kid) {
    matchingKeyEntry = keyring.primary;
  } else if (keyring.secondary && payload.kid === keyring.secondary.kid) {
    matchingKeyEntry = keyring.secondary;
  }

  if (!matchingKeyEntry) {
    throw new Error("Unknown cursor key identifier");
  }

  const cryptoKey = await importHmacKey(matchingKeyEntry.secretHex);
  const isValid = await globalThis.crypto.subtle.verify(
    "HMAC",
    cryptoKey,
    signatureBytes as Uint8Array<ArrayBuffer>,
    payloadBytes as Uint8Array<ArrayBuffer>,
  );

  if (!isValid) {
    throw new Error("Invalid cursor signature");
  }

  return payload;
}
