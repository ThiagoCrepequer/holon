import { describe, expect, it } from "vitest";

import { parseCursorKeyring } from "../workers/security/keyring.js";

describe("parseCursorKeyring", () => {
  it("fails closed when config is missing or empty", () => {
    expect(() => parseCursorKeyring(undefined)).toThrow(
      "ADMIN_CURSOR_HMAC_KEYS is required",
    );
    expect(() => parseCursorKeyring("")).toThrow(
      "ADMIN_CURSOR_HMAC_KEYS is required",
    );
    expect(() => parseCursorKeyring("   ")).toThrow(
      "ADMIN_CURSOR_HMAC_KEYS is required",
    );
  });

  it("parses valid JSON keyring", () => {
    const validKeyring = {
      primary: {
        kid: "custom-key-1",
        secretHex:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      },
      secondary: {
        kid: "custom-key-2",
        secretHex:
          "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      },
    };

    const parsed = parseCursorKeyring(JSON.stringify(validKeyring));
    expect(parsed.primary.kid).toBe("custom-key-1");
    expect(parsed.secondary?.kid).toBe("custom-key-2");
  });

  it("parses comma-separated string format", () => {
    const secret1 =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const secret2 =
      "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    const raw = `key-1:${secret1}, key-2:${secret2}`;

    const parsed = parseCursorKeyring(raw);
    expect(parsed.primary.kid).toBe("key-1");
    expect(parsed.primary.secretHex).toBe(secret1);
    expect(parsed.secondary?.kid).toBe("key-2");
    expect(parsed.secondary?.secretHex).toBe(secret2);
  });

  it("parses single key entry in comma-separated format without secondary", () => {
    const secret1 =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const raw = `key-single:${secret1}`;

    const parsed = parseCursorKeyring(raw);
    expect(parsed.primary.kid).toBe("key-single");
    expect(parsed.primary.secretHex).toBe(secret1);
    expect(parsed.secondary).toBeUndefined();
  });

  it("throws validation error for invalid hex or malformed entries", () => {
    expect(() => parseCursorKeyring("invalid:not-hex")).toThrow();
  });
});
