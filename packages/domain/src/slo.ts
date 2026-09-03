import type { RunState } from "./review-run.js";

export interface RunSloInput {
  readonly durationMs: number;
  readonly queueWaitMs: number;
  readonly terminalState: RunState;
  readonly toolCallsCount: number;
}

export interface SloThresholds {
  readonly maxExecutionDurationMs: number;
  readonly maxQueueWaitMs: number;
  readonly maxToolCallsCount: number;
}

export const DEFAULT_SLO_THRESHOLDS: SloThresholds = {
  maxExecutionDurationMs: 180_000, // 3 minutes
  maxQueueWaitMs: 30_000, // 30 seconds
  maxToolCallsCount: 15,
};

export interface SloEvaluationResult {
  readonly compliant: boolean;
  readonly violations: readonly string[];
}

export function evaluateRunSlo(
  run: RunSloInput,
  customThresholds?: Partial<SloThresholds>,
): SloEvaluationResult {
  const thresholds: SloThresholds = {
    ...DEFAULT_SLO_THRESHOLDS,
    ...customThresholds,
  };

  const violations: string[] = [];

  if (run.queueWaitMs > thresholds.maxQueueWaitMs) {
    violations.push(
      `Queue wait exceeded threshold: ${run.queueWaitMs}ms > ${thresholds.maxQueueWaitMs}ms`,
    );
  }

  if (run.durationMs > thresholds.maxExecutionDurationMs) {
    violations.push(
      `Execution duration exceeded threshold: ${run.durationMs}ms > ${thresholds.maxExecutionDurationMs}ms`,
    );
  }

  if (run.toolCallsCount > thresholds.maxToolCallsCount) {
    violations.push(
      `Tool calls count exceeded threshold: ${run.toolCallsCount} > ${thresholds.maxToolCallsCount}`,
    );
  }

  if (run.terminalState === "failed_terminal") {
    violations.push("Terminal state failed: review encountered terminal error");
  }

  return {
    compliant: violations.length === 0,
    violations,
  };
}
