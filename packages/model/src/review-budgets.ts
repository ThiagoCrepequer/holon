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

/** Shared across parallel shards; unused time is available to later phases. */
export const reviewTimeBudget = {
  analysisMs: 17 * 60_000,
  investigationMs: 9 * 60_000,
  finalizationMs: 3 * 60_000,
  recoveryMs: 3 * 60_000,
  completionReserveMs: 2 * 60_000,
  callMs: 3 * 60_000,
  minimumRetryMs: 60_000,
  synthesisMs: 90_000,
  persistenceReserveMs: 30_000,
  workflowStepMs: 19 * 60_000,
} as const;

export type GenerationPhase =
  | "investigation"
  | "finalization"
  | "recovery"
  | "synthesis";
export type GenerationTimeoutReason =
  | "model_call_timeout"
  | "phase_budget_exhausted";

export class ModelGenerationTimeoutError extends Error {
  constructor(
    public readonly phase: GenerationPhase,
    public readonly reason: GenerationTimeoutReason,
  ) {
    super(`HOLON_MODEL_TIMEOUT:${phase}:${reason}`);
    this.name = "ModelGenerationTimeoutError";
  }
}

export function generationDeadline(
  deadlineAt: number,
  phase: GenerationPhase,
  now = Date.now(),
): number {
  if (!Number.isFinite(deadlineAt))
    throw new TypeError("Invalid review deadline");
  const reserve =
    phase === "investigation"
      ? reviewTimeBudget.finalizationMs +
        reviewTimeBudget.recoveryMs +
        reviewTimeBudget.completionReserveMs
      : phase === "finalization"
        ? reviewTimeBudget.recoveryMs + reviewTimeBudget.completionReserveMs
        : phase === "recovery"
          ? reviewTimeBudget.completionReserveMs
          : reviewTimeBudget.persistenceReserveMs;
  const allowance =
    phase === "investigation"
      ? reviewTimeBudget.investigationMs
      : phase === "finalization"
        ? reviewTimeBudget.finalizationMs
        : phase === "recovery"
          ? reviewTimeBudget.recoveryMs
          : reviewTimeBudget.synthesisMs;
  return Math.min(deadlineAt - reserve, now + allowance);
}
