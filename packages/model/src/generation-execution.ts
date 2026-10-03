import { APICallError } from "ai";

import {
  ModelGenerationTimeoutError,
  reviewTimeBudget,
  type GenerationPhase,
} from "./review-budgets.js";

export interface GenerationEvent {
  readonly event:
    | "model.investigation_stopped"
    | "model.investigation_progress"
    | "model.phase_started"
    | "model.phase_finished"
    | "model.phase_failed"
    | "model.round_started"
    | "model.round_finished"
    | "model.recovery_scheduled";
  readonly phase: GenerationPhase;
  readonly attempt: number;
  readonly round?: number;
  readonly toolCalls?: number;
  readonly reasoningTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
  readonly repositoryRequests?: number;
  readonly cacheHits?: number;
  readonly coveringReadHits?: number;
  readonly truncatedResults?: number;
  readonly readCalls?: number;
  readonly searchCalls?: number;
  readonly reviewedChecks?: number;
  readonly pendingChecks?: number;
  readonly blockedChecks?: number;
  readonly closing?: boolean;
  readonly durationMs?: number;
  readonly roundDurationMs?: number;
  readonly timeoutScope?: "generation_step" | "phase";
  readonly timeoutMs?: number;
  readonly remainingMs: number;
  readonly reason?: string;
  readonly rule?: string;
  readonly current?: number;
  readonly limit?: number;
  readonly statusCode?: number;
  readonly retryable?: boolean;
}
export type GenerationObserver = (event: GenerationEvent) => void;

export function observeGeneration(
  observer: GenerationObserver | undefined,
  event: GenerationEvent,
): void {
  try {
    observer?.(event);
  } catch {
    /* Logging cannot change review results. */
  }
}

export function isTransientGenerationError(error: unknown): boolean {
  return (
    error instanceof ModelGenerationTimeoutError ||
    (APICallError.isInstance(error) && error.isRetryable)
  );
}

/** One phase attempt; the deadline is fixed before retrying, never renewed. */
export async function executeGeneration<T>(
  phase: GenerationPhase,
  attempt: number,
  phaseDeadlineAt: number,
  observer: GenerationObserver | undefined,
  execute: (lifecycle: {
    abortSignal: AbortSignal;
    timeout: { stepMs: number };
    setStepDeadline: (deadlineAt: number) => void;
    onStepStart: () => void;
    onStepFinish: () => void;
  }) => Promise<T>,
  abortSignal?: AbortSignal,
): Promise<T> {
  abortSignal?.throwIfAborted();
  const startedAt = Date.now();
  const remaining = () => Math.max(0, phaseDeadlineAt - Date.now());
  const timeoutMs = Math.min(reviewTimeBudget.callMs, remaining());
  const emit = (
    event: GenerationEvent["event"],
    details: Partial<GenerationEvent> = {},
  ) =>
    observeGeneration(observer, {
      event,
      phase,
      attempt,
      remainingMs: remaining(),
      ...details,
    });
  if (timeoutMs <= 0) {
    emit("model.phase_failed", {
      durationMs: 0,
      timeoutMs: 0,
      reason: "phase_budget_exhausted",
    });
    throw new ModelGenerationTimeoutError(phase, "phase_budget_exhausted");
  }
  const controller = new AbortController();
  const signal = abortSignal
    ? AbortSignal.any([controller.signal, abortSignal])
    : controller.signal;
  const timer = setTimeout(
    () =>
      controller.abort(
        new ModelGenerationTimeoutError(phase, "phase_budget_exhausted"),
      ),
    remaining(),
  );
  let stepTimer: ReturnType<typeof setTimeout> | undefined;
  let roundTimeoutMs = timeoutMs;
  let round = 0;
  let roundStartedAt = startedAt;
  emit("model.phase_started", { timeoutMs: remaining() });
  try {
    const result = await execute({
      setStepDeadline: (deadlineAt) => {
        clearTimeout(stepTimer);
        roundTimeoutMs = Math.max(
          0,
          Math.min(timeoutMs, deadlineAt - Date.now()),
        );
        stepTimer = setTimeout(
          () =>
            controller.abort(
              new ModelGenerationTimeoutError(phase, "generation_step_timeout"),
            ),
          roundTimeoutMs,
        );
      },
      abortSignal: signal,
      timeout: { stepMs: timeoutMs },
      onStepStart: () => {
        round++;
        roundStartedAt = Date.now();
        emit("model.round_started", {
          round,
          timeoutMs: Math.min(roundTimeoutMs, remaining()),
        });
      },
      onStepFinish: () => {
        clearTimeout(stepTimer);
        emit("model.round_finished", {
          round,
          durationMs: Date.now() - roundStartedAt,
        });
      },
    });
    signal.throwIfAborted();
    emit("model.phase_finished", { durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    const classified = signal.aborted
      ? signal.reason
      : error instanceof Error && error.name === "TimeoutError"
        ? new ModelGenerationTimeoutError(phase, "generation_step_timeout")
        : error;
    const reason = abortSignal?.aborted
      ? "review_cancelled"
      : classified instanceof ModelGenerationTimeoutError
        ? classified.reason
        : APICallError.isInstance(classified)
          ? classified.isRetryable
            ? "provider_transient"
            : "provider_permanent"
          : classified instanceof Error &&
              classified.name === "ModelReviewBudgetExceededError"
            ? "model_budget_exhausted"
            : "generation_failed";
    emit("model.phase_failed", {
      ...(APICallError.isInstance(classified)
        ? {
            statusCode: classified.statusCode,
            retryable: classified.isRetryable,
          }
        : {}),
      round,
      roundDurationMs: Date.now() - roundStartedAt,
      ...(classified instanceof ModelGenerationTimeoutError
        ? {
            timeoutScope:
              classified.reason === "phase_budget_exhausted"
                ? ("phase" as const)
                : ("generation_step" as const),
          }
        : {}),
      durationMs: Date.now() - startedAt,
      timeoutMs: roundTimeoutMs,
      reason,
    });
    throw classified;
  } finally {
    clearTimeout(timer);
    clearTimeout(stepTimer);
  }
}
