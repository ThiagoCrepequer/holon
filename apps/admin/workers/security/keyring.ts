import { type CursorKeyring, cursorKeyringSchema } from "@holon/contracts";

export const DEFAULT_DEV_KEYRING: CursorKeyring = {
  primary: {
    kid: "cursor-key-primary",
    secretHex:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  },
  secondary: {
    kid: "cursor-key-secondary",
    secretHex:
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  },
};

export function parseCursorKeyring(keysConfig?: string): CursorKeyring {
  if (!keysConfig || keysConfig.trim() === "") {
    return DEFAULT_DEV_KEYRING;
  }

  try {
    const parsed = JSON.parse(keysConfig);
    return cursorKeyringSchema.parse(parsed);
  } catch {
    const entries = keysConfig.split(",").map((item) => {
      const [kid, secretHex] = item.split(":");
      return { kid: kid?.trim() ?? "", secretHex: secretHex?.trim() ?? "" };
    });
    const primary = entries[0];
    const secondary = entries[1];
    return cursorKeyringSchema.parse({
      primary,
      secondary: secondary ? secondary : undefined,
    });
  }
}
