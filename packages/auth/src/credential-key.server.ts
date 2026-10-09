import { authSecretRingSchema } from "@holon/contracts/dashboard-collaboration";
import type { SecretConfig } from "better-auth/crypto";
export function credentialKeyConfig(
  secret: string,
  raw?: unknown,
): {
  cryptoKey: string | SecretConfig;
  secrets?: { version: number; value: string }[];
} {
  if (raw === undefined) return { cryptoKey: secret };
  const keys = authSecretRingSchema.parse(raw);
  const first = keys[0];
  if (!first) throw new Error("missing secret version");
  return {
    secrets: keys,
    cryptoKey: {
      keys: new Map(keys.map((k) => [k.version, k.value])),
      currentVersion: first.version,
      legacySecret: secret,
    },
  };
}
