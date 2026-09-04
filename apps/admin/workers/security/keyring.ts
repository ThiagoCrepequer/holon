import { type CursorKeyring, cursorKeyringSchema } from "@holon/contracts";

export function parseCursorKeyring(keysConfig?: string): CursorKeyring {
  if (!keysConfig || keysConfig.trim() === "") {
    throw new Error("ADMIN_CURSOR_HMAC_KEYS is required");
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
