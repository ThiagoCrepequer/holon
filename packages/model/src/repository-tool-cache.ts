import { repositoryToolCallSchema } from "@holon/contracts";

import type { RepositoryToolRunner, RepositoryToolResult } from "./reviewer.js";

/** Run-local memoization for an immutable SHA; errors are never cached. */
export function createRepositoryToolCache(
  delegate: RepositoryToolRunner,
): RepositoryToolRunner {
  const results = new Map<string, Promise<RepositoryToolResult>>();
  return {
    run(raw) {
      const call = repositoryToolCallSchema.parse(raw);
      const key = JSON.stringify(call);
      const existing = results.get(key);
      if (existing) return existing;
      const pending = Promise.resolve()
        .then(() => delegate.run(call))
        .catch((error: unknown) => {
          results.delete(key);
          throw error;
        });
      results.set(key, pending);
      return pending;
    },
  };
}
