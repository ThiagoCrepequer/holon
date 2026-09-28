import { APICallError } from "ai";

import {
  ModelGenerationTimeoutError,
  reviewTimeBudget,
  type GenerationPhase,
} from "./review-budgets.js";

export interface GenerationEvent {
  readonly event:
    | "model.investigation_stopped"
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
  readonly durationMs?: number;
  readonly timeoutMs?: number;
  readonly remainingMs: number;
  readonly reason?: string;
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
    onStepStart: () => void;
    onStepFinish: () => void;
  }) => Promise<T>,
): Promise<T> {
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
  const timer = setTimeout(
    () =>
      controller.abort(
        new ModelGenerationTimeoutError(phase, "phase_budget_exhausted"),
      ),
    remaining(),
  );
  let round = 0;
  let roundStartedAt = startedAt;
  emit("model.phase_started", { timeoutMs: remaining() });
  try {
    const result = await execute({
      abortSignal: controller.signal,
      timeout: { stepMs: timeoutMs },
      onStepStart: () => {
        round++;
        roundStartedAt = Date.now();
        emit("model.round_started", {
          round,
          timeoutMs: Math.min(timeoutMs, remaining()),
        });
      },
      onStepFinish: () =>
        emit("model.round_finished", {
          round,
          durationMs: Date.now() - roundStartedAt,
        }),
    });
    controller.signal.throwIfAborted();
    emit("model.phase_finished", { durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    const classified = controller.signal.aborted
      ? controller.signal.reason
      : error instanceof Error && error.name === "TimeoutError"
        ? new ModelGenerationTimeoutError(phase, "model_call_timeout")
        : error;
    const reason =
      classified instanceof ModelGenerationTimeoutError
        ? classified.reason
        : APICallError.isInstance(classified)
          ? classified.isRetryable
            ? "provider_transient"
            : "provider_permanent"
          : "generation_failed";
    emit("model.phase_failed", {
      round,
      durationMs: Date.now() - startedAt,
      timeoutMs,
      reason,
    });
    throw classified;
  } finally {
    clearTimeout(timer);
  }
}
