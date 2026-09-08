import {
  RepositoryToolBudgetExceededError,
  type RepositoryToolRunner,
} from "./reviewer.js";

export function createPartitionedRepositoryToolRunner(
  delegate: RepositoryToolRunner,
  totalCalls: number,
) {
  if (!Number.isSafeInteger(totalCalls) || totalCalls <= 0)
    throw new TypeError("Invalid tool budget");
  let remaining = totalCalls;
  let limit = totalCalls;
  let exhausted = false;
  return {
    beginShard(index: number, totalShards: number): void {
      if (
        !Number.isSafeInteger(index) ||
        !Number.isSafeInteger(totalShards) ||
        index < 0 ||
        totalShards <= index
      )
        throw new TypeError("Invalid shard index");
      limit =
        Math.floor(totalCalls / totalShards) +
        (index < totalCalls % totalShards ? 1 : 0);
      remaining = limit;
      exhausted = false;
    },
    exceeded: () => exhausted,
    runner: {
      async run(call) {
        if (remaining <= 0) {
          exhausted = true;
          throw new RepositoryToolBudgetExceededError(limit);
        }
        remaining -= 1;
        try {
          return await delegate.run(call);
        } catch (error) {
          if (error instanceof RepositoryToolBudgetExceededError)
            exhausted = true;
          throw error;
        }
      },
    } satisfies RepositoryToolRunner,
  };
}

export function generationTimeout(
  deadlineAt: number,
  phase: "investigation" | "finalization" | "recovery",
  now = Date.now(),
) {
  const remaining = Math.floor(deadlineAt - now);
  if (!Number.isFinite(remaining) || remaining <= 0)
    throw new Error("Review generation deadline exceeded");
  const fraction =
    phase === "investigation" ? 0.6 : phase === "finalization" ? 0.5 : 1;
  return {
    totalMs: Math.max(1, Math.floor(remaining * fraction)),
    stepMs: Math.min(30_000, remaining),
  };
}
