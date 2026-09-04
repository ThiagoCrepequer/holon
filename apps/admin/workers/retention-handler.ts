import type { D1AdminStorage } from "./d1-adapter.js";
import type { RetentionCleanupResult } from "./types.js";

export async function processRetentionCleanup(
  storage: D1AdminStorage,
  options?: { now?: () => number },
): Promise<RetentionCleanupResult> {
  const result = await storage.cleanupRetention(options?.now?.());
  return result;
}
