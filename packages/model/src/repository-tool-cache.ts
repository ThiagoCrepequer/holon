import { repositoryToolCallSchema } from "@holon/contracts";
import { redactedSecret } from "@holon/domain";

import type { RepositoryToolRunner, RepositoryToolResult } from "./reviewer.js";

export interface RepositoryCacheMetrics {
  requests: number;
  hits: number;
  coveringReadHits: number;
  executorCalls: number;
  truncatedResults: number;
  readCalls: number;
  searchCalls: number;
}

/** Per investigation and immutable SHA. Failed or truncated reads never cover another range. */
export function createRepositoryToolCache(
  delegate: RepositoryToolRunner,
): RepositoryToolRunner & { metrics(): RepositoryCacheMetrics } {
  const results = new Map<string, Promise<RepositoryToolResult>>();
  const reads: Array<{ path: string; start: number; lines: string[] }> = [];
  const metrics: RepositoryCacheMetrics = {
    requests: 0,
    hits: 0,
    coveringReadHits: 0,
    executorCalls: 0,
    truncatedResults: 0,
    readCalls: 0,
    searchCalls: 0,
  };
  return {
    metrics: () => ({ ...metrics }),
    run(raw, execution) {
      execution?.abortSignal?.throwIfAborted();
      const parsed = repositoryToolCallSchema.parse(raw);
      const call =
        parsed.name === "read_file"
          ? {
              ...parsed,
              arguments: {
                path: parsed.arguments.path,
                startLine: parsed.arguments.startLine ?? 1,
                endLine:
                  parsed.arguments.endLine ??
                  (parsed.arguments.startLine ?? 1) + 199,
              },
            }
          : parsed;
      if (call.name !== "read_file" && call.arguments.paths !== undefined)
        call.arguments.paths = [...new Set(call.arguments.paths)].toSorted();
      metrics.requests++;
      const key = JSON.stringify(call);
      const existing = results.get(key);
      if (existing) {
        metrics.hits++;
        return existing;
      }
      if (call.name === "read_file") {
        const start = call.arguments.startLine;
        const end = call.arguments.endLine;
        const covering = reads.find(
          (read) =>
            read.path === call.arguments.path &&
            read.start <= start &&
            read.start + read.lines.length > end,
        );
        if (covering) {
          metrics.hits++;
          metrics.coveringReadHits++;
          return Promise.resolve({
            content: covering.lines
              .slice(start - covering.start, end - covering.start + 1)
              .join("\n"),
            truncated: false,
          });
        }
      }
      metrics.executorCalls++;
      if (call.name === "read_file") metrics.readCalls++;
      else metrics.searchCalls++;
      const pending = Promise.resolve()
        .then(() => {
          execution?.abortSignal?.throwIfAborted();
          return delegate.run(call, execution);
        })
        .then((result) => {
          execution?.abortSignal?.throwIfAborted();
          if (result.truncated) metrics.truncatedResults++;
          if (
            call.name === "read_file" &&
            !result.truncated &&
            !result.content.includes(redactedSecret) &&
            result.content.length > 0
          ) {
            reads.push({
              path: call.arguments.path,
              start: call.arguments.startLine,
              lines: result.content
                .split("\n")
                .slice(
                  0,
                  call.arguments.endLine - call.arguments.startLine + 1,
                ),
            });
          }
          return result;
        })
        .catch((error: unknown) => {
          results.delete(key);
          throw error;
        });
      results.set(key, pending);
      return pending;
    },
  } satisfies RepositoryToolRunner & { metrics(): RepositoryCacheMetrics };
}
