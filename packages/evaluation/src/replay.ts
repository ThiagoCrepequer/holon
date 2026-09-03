import type {
  CostAccounting,
  RunTelemetry,
  StepTiming,
} from "@holon/contracts";
import {
  calculateInferenceCost,
  evaluateRunSlo,
  type SloEvaluationResult,
} from "@holon/domain";

export interface IncidentReplayReport {
  readonly discrepancies: readonly string[];
  readonly originalCost: CostAccounting;
  readonly prKey: string;
  readonly runId: string;
  readonly sloEvaluation: SloEvaluationResult;
  readonly stepTimingsSummary: {
    readonly failedSteps: readonly StepTiming[];
    readonly slowestStep?: StepTiming | undefined;
    readonly totalDurationMs: number;
  };
  readonly verificationOutcome: "consistent" | "discrepancy_detected";
  readonly verifiedCost: CostAccounting;
}

export function replayIncidentTelemetry(
  telemetry: RunTelemetry,
): IncidentReplayReport {
  const discrepancies: string[] = [];

  // Re-compute cost deterministically
  const verifiedCost = calculateInferenceCost(
    telemetry.cost.pricingModel,
    telemetry.tokens,
  );

  if (
    verifiedCost.estimatedCostMicroUsd !== telemetry.cost.estimatedCostMicroUsd
  ) {
    discrepancies.push(
      `Cost calculation mismatch: recorded ${telemetry.cost.estimatedCostMicroUsd}µUSD, recomputed ${verifiedCost.estimatedCostMicroUsd}µUSD`,
    );
  }

  // Evaluate SLOs deterministically
  const sloEvaluation = evaluateRunSlo(telemetry);

  // Analyze step timings
  const failedSteps = telemetry.stepTimings.filter(
    (step) => step.status === "failure",
  );
  const slowestStep = telemetry.stepTimings.toSorted(
    (a, b) => b.durationMs - a.durationMs,
  )[0];

  const sumStepDurations = telemetry.stepTimings.reduce(
    (acc, step) => acc + step.durationMs,
    0,
  );

  if (
    telemetry.stepTimings.length > 0 &&
    sumStepDurations > telemetry.durationMs
  ) {
    discrepancies.push(
      `Sum of step timings (${sumStepDurations}ms) exceeded total run duration (${telemetry.durationMs}ms)`,
    );
  }

  return {
    discrepancies,
    originalCost: telemetry.cost,
    prKey: telemetry.prKey,
    runId: telemetry.runId,
    sloEvaluation,
    stepTimingsSummary: {
      failedSteps,
      slowestStep,
      totalDurationMs: telemetry.durationMs,
    },
    verificationOutcome:
      discrepancies.length === 0 ? "consistent" : "discrepancy_detected",
    verifiedCost,
  };
}
