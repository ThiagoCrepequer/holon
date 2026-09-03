import { describe, expect, it } from "vitest";

import {
  evaluateRunSlo,
  DEFAULT_SLO_THRESHOLDS,
  type RunSloInput,
} from "../src/slo.js";

function makeRun(overrides?: Partial<RunSloInput>): RunSloInput {
  return {
    durationMs: 45_000,
    queueWaitMs: 1500,
    terminalState: "completed",
    toolCallsCount: 5,
    ...overrides,
  };
}

describe("slo evaluation engine", () => {
  it("passes when all metrics are within default thresholds", () => {
    const telemetry = makeRun();
    const result = evaluateRunSlo(telemetry);
    expect(result.compliant).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("detects queue wait violation", () => {
    const telemetry = makeRun({
      queueWaitMs: DEFAULT_SLO_THRESHOLDS.maxQueueWaitMs + 1000,
    });
    const result = evaluateRunSlo(telemetry);
    expect(result.compliant).toBe(false);
    expect(result.violations[0]).toContain("Queue wait exceeded threshold");
  });

  it("detects execution duration violation", () => {
    const telemetry = makeRun({
      durationMs: DEFAULT_SLO_THRESHOLDS.maxExecutionDurationMs + 5000,
    });
    const result = evaluateRunSlo(telemetry);
    expect(result.compliant).toBe(false);
    expect(result.violations[0]).toContain(
      "Execution duration exceeded threshold",
    );
  });

  it("detects tool calls count violation", () => {
    const telemetry = makeRun({
      toolCallsCount: DEFAULT_SLO_THRESHOLDS.maxToolCallsCount + 1,
    });
    const result = evaluateRunSlo(telemetry);
    expect(result.compliant).toBe(false);
    expect(result.violations[0]).toContain(
      "Tool calls count exceeded threshold",
    );
  });

  it("detects terminal state failure", () => {
    const telemetry = makeRun({
      terminalState: "failed_terminal",
    });
    const result = evaluateRunSlo(telemetry);
    expect(result.compliant).toBe(false);
    expect(result.violations[0]).toContain("Terminal state failed");
  });

  it("supports custom thresholds overrides", () => {
    const telemetry = makeRun({
      durationMs: 10_000,
    });
    const result = evaluateRunSlo(telemetry, {
      maxExecutionDurationMs: 5_000,
    });
    expect(result.compliant).toBe(false);
    expect(result.violations[0]).toContain("10000ms > 5000ms");
  });
});
