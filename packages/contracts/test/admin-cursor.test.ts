import { describe, expect, it } from "vitest";

import {
  computeFilterHash,
  decodeAdminCursor,
  encodeAdminCursor,
  type CursorKeyring,
} from "../src/index.js";

const keyring: CursorKeyring = {
  primary: {
    kid: "cursor-key-2026-01",
    secretHex:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  },
  secondary: {
    kid: "cursor-key-2025-12",
    secretHex:
      "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
  },
};

const filterParams = {
  period: "24h" as const,
  repositoryId: 42,
  terminalState: "completed" as const,
  verdict: "APPROVE" as const,
  pageSize: 50 as const,
};

const runId = "github:42:pr:7:head:" + "a".repeat(40);

describe("admin cursor contracts and keyring", () => {
  it("computes deterministic filterHash for filter params", async () => {
    const hash1 = await computeFilterHash(filterParams);
    const hash2 = await computeFilterHash({ ...filterParams });
    expect(hash1).toMatch(/^[a-f0-9]{64}$/u);
    expect(hash1).toBe(hash2);

    // Changing any filter parameter changes the hash
    const hashDifferent = await computeFilterHash({
      ...filterParams,
      pageSize: 20,
    });
    expect(hashDifferent).not.toBe(hash1);

    const searchHash = await computeFilterHash({
      ...filterParams,
      searchQuery: "owner/repo#7",
    });
    expect(searchHash).not.toBe(hash1);
  });

  it("encodes and decodes cursor successfully with primary key", async () => {
    const filterHash = await computeFilterHash(filterParams);
    const now = 1756980000000;
    const token = await encodeAdminCursor(
      {
        filterHash,
        runId,
        terminalAtEpochMs: now - 10000,
      },
      keyring,
      now,
    );

    expect(typeof token).toBe("string");
    expect(token).toContain(".");

    const decoded = await decodeAdminCursor(
      token,
      filterHash,
      keyring,
      now + 1000,
    );

    expect(decoded.v).toBe(1);
    expect(decoded.runId).toBe(runId);
    expect(decoded.filterHash).toBe(filterHash);
    expect(decoded.terminalAtEpochMs).toBe(now - 10000);
    expect(decoded.issuedAtEpochMs).toBe(now);
    expect(decoded.kid).toBe(keyring.primary.kid);
  });

  it("decodes cursor issued with secondary key during key rotation", async () => {
    const filterHash = await computeFilterHash(filterParams);
    const now = 1756980000000;

    // Issue with secondary key
    const secondaryKeyring: CursorKeyring = {
      primary: keyring.secondary!,
    };
    const token = await encodeAdminCursor(
      {
        filterHash,
        runId,
        terminalAtEpochMs: now - 5000,
      },
      secondaryKeyring,
      now,
    );

    // Decode with full keyring (primary + secondary)
    const decoded = await decodeAdminCursor(
      token,
      filterHash,
      keyring,
      now + 500,
    );
    expect(decoded.kid).toBe(keyring.secondary!.kid);
    expect(decoded.runId).toBe(runId);
  });

  it("rejects expired cursor (> 24 hours)", async () => {
    const filterHash = await computeFilterHash(filterParams);
    const now = 1756980000000;
    const token = await encodeAdminCursor(
      {
        filterHash,
        runId,
        terminalAtEpochMs: now - 10000,
      },
      keyring,
      now,
    );

    const after25Hours = now + 25 * 60 * 60 * 1000;
    await expect(
      decodeAdminCursor(token, filterHash, keyring, after25Hours),
    ).rejects.toThrow(/expired/iu);
  });

  it("rejects cursor with mismatched filterHash", async () => {
    const filterHash1 = await computeFilterHash(filterParams);
    const filterHash2 = await computeFilterHash({
      ...filterParams,
      verdict: "COMMENT",
    });
    const now = 1756980000000;
    const token = await encodeAdminCursor(
      {
        filterHash: filterHash1,
        runId,
        terminalAtEpochMs: now - 10000,
      },
      keyring,
      now,
    );

    await expect(
      decodeAdminCursor(token, filterHash2, keyring, now + 1000),
    ).rejects.toThrow(/filter mismatch/iu);
  });

  it("rejects tampered signature", async () => {
    const filterHash = await computeFilterHash(filterParams);
    const now = 1756980000000;
    const token = await encodeAdminCursor(
      {
        filterHash,
        runId,
        terminalAtEpochMs: now - 10000,
      },
      keyring,
      now,
    );

    const [payloadB64, sigB64] = token.split(".");
    const tamperedSig = sigB64!.replace(
      /^./u,
      sigB64!.startsWith("a") ? "b" : "a",
    );
    const tamperedToken = `${payloadB64}.${tamperedSig}`;

    await expect(
      decodeAdminCursor(tamperedToken, filterHash, keyring, now + 1000),
    ).rejects.toThrow(/invalid cursor/iu);
  });

  it("rejects malformed token format", async () => {
    const filterHash = await computeFilterHash(filterParams);
    await expect(
      decodeAdminCursor("not-a-token", filterHash, keyring),
    ).rejects.toThrow(/invalid cursor/iu);
  });
});
