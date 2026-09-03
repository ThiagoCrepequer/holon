import type { RunTelemetry } from "@holon/contracts";
import { describe, expect, it } from "vitest";

import { replayIncidentTelemetry } from "../src/replay.js";

function makeRunTelemetry(overrides?: Partial<RunTelemetry>): RunTelemetry {
  return {
    cost: {
      currency: "USD",
      estimatedCostMicroUsd: 420,
      estimatedCostUsd: 0.00042,
      pricingModel: "deepseek-chat",
    },
    createdAt: "2026-09-03T12:00:00.000Z",
    durationMs: 15_000,
    headSha: "a".repeat(40),
    isDegraded: false,
    prKey: "github:42:pr:12",
    queueWaitMs: 500,
    runId: "run:replay-test-1",
    scopeStatus: "complete",
    shardsCount: 1,
    stepTimings: [
      {
        attempt: 1,
        durationMs: 4_000,
        status: "success",
        stepName: "prepare-repository",
      },
      {
        attempt: 1,
        durationMs: 8_000,
        status: "success",
        stepName: "analyze-review",
      },
    ],
    terminalState: "completed",
    tokens: {
      inputTokens: 1000,
      outputTokens: 1000,
      totalTokens: 2000,
    },
    toolCallsCount: 4,
    verdict: "APPROVE",
    ...overrides,
  };
}

describe("replayIncidentTelemetry", () => {
  it("replays consistent telemetry without discrepancies", () => {
    const telemetry = makeRunTelemetry();
    const report = replayIncidentTelemetry(telemetry);

    expect(report.runId).toBe("run:replay-test-1");
    expect(report.verificationOutcome).toBe("consistent");
    expect(report.discrepancies).toHaveLength(0);
    expect(report.sloEvaluation.compliant).toBe(true);
    expect(report.stepTimingsSummary.failedSteps).toHaveLength(0);
    expect(report.stepTimingsSummary.slowestStep?.stepName).toBe(
      "analyze-review",
    );
  });

  it("detects cost discrepancies when recorded cost does not match deterministic formula", () => {
    const telemetry = makeRunTelemetry({
      cost: {
        currency: "USD",
        estimatedCostMicroUsd: 999999, // Tampered or corrupted recorded cost
        estimatedCostUsd: 0.999999,
        pricingModel: "deepseek-chat",
      },
    });

    const report = replayIncidentTelemetry(telemetry);
    expect(report.verificationOutcome).toBe("discrepancy_detected");
    expect(report.discrepancies[0]).toContain("Cost calculation mismatch");
  });

  it("detects timing discrepancies when sum of steps exceeds total duration", () => {
    const telemetry = makeRunTelemetry({
      durationMs: 5_000, // Steps total 12,000ms
    });

    const report = replayIncidentTelemetry(telemetry);
    expect(report.verificationOutcome).toBe("discrepancy_detected");
    expect(report.discrepancies[0]).toContain(
      "Sum of step timings (12000ms) exceeded total run duration",
    );
  });

  it("identifies failed steps and tracks SLO violations in report", () => {
    const telemetry = makeRunTelemetry({
      stepTimings: [
        {
          attempt: 1,
          durationMs: 3000,
          status: "failure",
          stepName: "prepare-repository",
        },
      ],
      terminalState: "failed_terminal",
    });

    const report = replayIncidentTelemetry(telemetry);
    expect(report.stepTimingsSummary.failedSteps).toHaveLength(1);
    expect(report.sloEvaluation.compliant).toBe(false);
  });
});
