import {
  repositoryToolResultSchema,
  type RepositoryToolResult,
} from "@holon/contracts";

/** Ephemeral read results owned by one run's Sandbox DO. Eviction only loses an optimization. */
export class SnapshotToolCache {
  private readonly entries = new Map<
    string,
    { readonly result: RepositoryToolResult; readonly bytes: number }
  >();
  private readonly pending = new Map<string, Promise<RepositoryToolResult>>();
  private bytes = 0;
  private epoch = 0;
  snapshot(): readonly { key: string; result: RepositoryToolResult }[] {
    return [...this.entries].map(([key, value]) => ({
      key,
      result: { ...value.result },
    }));
  }

  async read(
    key: string,
    execute: () => Promise<RepositoryToolResult>,
  ): Promise<{ result: RepositoryToolResult; reused: boolean }> {
    const cached = this.entries.get(key);
    if (cached) return { result: { ...cached.result }, reused: true };
    const inflight = this.pending.get(key);
    if (inflight) return { result: { ...(await inflight) }, reused: true };
    const epoch = this.epoch;
    const pending = Promise.resolve()
      .then(execute)
      .then((raw) => {
        const result = repositoryToolResultSchema.parse(raw);
        const bytes = new TextEncoder().encode(key + result.content).byteLength;
        // Partial and empty search responses do not become reusable absence proofs.
        if (
          epoch === this.epoch &&
          !result.truncated &&
          result.content.length &&
          bytes <= 100_000
        ) {
          while (
            (this.bytes + bytes > 1_000_000 || this.entries.size >= 32) &&
            this.entries.size
          ) {
            const oldest = this.entries.entries().next().value!;
            this.entries.delete(oldest[0]);
            this.bytes -= oldest[1].bytes;
          }
          this.entries.set(key, { result, bytes });
          this.bytes += bytes;
        }
        return result;
      });
    this.pending.set(key, pending);
    try {
      return { result: { ...(await pending) }, reused: false };
    } finally {
      if (this.pending.get(key) === pending) this.pending.delete(key);
    }
  }

  /** Fence late completions, then join owned physical operations before terminal destruction. */
  async clear(): Promise<void> {
    this.epoch++;
    this.entries.clear();
    this.bytes = 0;
    await Promise.allSettled(this.pending.values());
  }
}
