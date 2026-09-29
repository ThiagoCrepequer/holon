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

/** A completed-only cache scoped to one immutable run, never shared promises. */
export function createRepositoryToolCacheStore() {
  const results = new Map<
    string,
    { result: RepositoryToolResult; bytes: number }
  >();
  let bytes = 0;
  return {
    get: (key: string) => results.get(key)?.result,
    set(key: string, result: RepositoryToolResult) {
      if (result.truncated || result.content.includes(redactedSecret)) return;
      const size = new TextEncoder().encode(key + result.content).byteLength;
      if (size > 2_000_000) return;
      bytes -= results.get(key)?.bytes ?? 0;
      results.delete(key);
      while (results.size >= 128 || bytes + size > 2_000_000) {
        const oldest = results.keys().next().value!;
        bytes -= results.get(oldest)!.bytes;
        results.delete(oldest);
      }
      results.set(key, { result: { ...result }, bytes: size });
      bytes += size;
    },
  };
}
export type RepositoryToolCacheStore = ReturnType<
  typeof createRepositoryToolCacheStore
>;

/** Per investigation and immutable SHA. Failed or truncated reads never cover another range. */
export function createRepositoryToolCache(
  delegate: RepositoryToolRunner,
  shared?: RepositoryToolCacheStore,
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
      const completed = shared?.get(key);
      if (completed) {
        metrics.hits++;
        return Promise.resolve({ ...completed });
      }
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
          shared?.set(key, result);
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
