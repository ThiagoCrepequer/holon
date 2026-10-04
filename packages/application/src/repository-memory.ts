import type { MemoryCommand, MemorySnapshot } from "@holon/contracts";
import {
  memoryCommandSchema,
  memoryLimits,
  memorySnapshotSchema,
} from "@holon/contracts";

export function parseMemoryCommand(body: string): MemoryCommand | undefined {
  const text = body.trim();
  if (text === "/holon memory list") return { action: "list" };
  const proposal =
    /^\/holon memory propose ([^\s|]+)(?: replaces:([a-f0-9]{64}))?\s*\|\s*([\s\S]+)$/u.exec(
      text,
    );
  const decision =
    /^\/holon memory (approve|reject|revoke|inspect) ([a-f0-9]{64}) ([a-f0-9]{64})$/u.exec(
      text,
    );
  const parsed = memoryCommandSchema.safeParse(
    proposal
      ? {
          action: "propose",
          root: proposal[1],
          guidance: proposal[3],
          ...(proposal[2] ? { supersedes: proposal[2] } : {}),
        }
      : decision
        ? { action: decision[1], id: decision[2], digest: decision[3] }
        : null,
  );
  return parsed.success ? parsed.data : undefined;
}
export function memoryScopeMatches(root: string, path: string): boolean {
  return root === "." || root === path || path.startsWith(root + "/");
}
/** Historical observations always require current-code verification. Approved rules are guidance, never authority to suppress. */
export function projectRepositoryMemory(
  raw: MemorySnapshot,
  paths: readonly string[],
): MemorySnapshot {
  const snapshot = memorySnapshotSchema.parse(raw);
  const result = {
    ...snapshot,
    rules: snapshot.rules.filter(
      (rule) =>
        rule.state === "active" &&
        paths.some((path) => memoryScopeMatches(rule.root, path)),
    ),
    observations: snapshot.observations.filter((item) =>
      paths.includes(item.path),
    ),
  };
  if (
    new TextEncoder().encode(JSON.stringify(result)).byteLength >
    memoryLimits.shardBytes
  )
    throw new Error("Repository memory exceeds shard budget");
  return result;
}
