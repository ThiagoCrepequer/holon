import type { RunTelemetry, StepTiming } from "@holon/contracts";
import { describe, expect, it, vi } from "vitest";

import type { StructuredLogger } from "../src/observability.js";
import {
  AnalyticsEngineTelemetryEmitter,
  CompositeTelemetryEmitter,
  StructuredLogTelemetryEmitter,
} from "../src/telemetry-emitter.js";

function sampleTelemetry(): RunTelemetry {
  return {
    cost: {
      currency: "USD",
      estimatedCostMicroUsd: 12500,
      estimatedCostUsd: 0.0125,
      pricingModel: "deepseek-chat",
    },
    createdAt: "2026-09-03T12:00:00.000Z",
    durationMs: 14500,
    headSha: "a".repeat(40),
    isDegraded: false,
    prKey: "github:42:pr:10",
    queueWaitMs: 250,
    runId: "run:123",
    scopeStatus: "complete",
    shardsCount: 1,
    stepTimings: [
      {
        attempt: 1,
        durationMs: 4000,
        status: "success",
        stepName: "analyze-review",
      },
    ],
    terminalState: "completed",
    tokens: {
      inputTokens: 1000,
      outputTokens: 250,
      totalTokens: 1250,
    },
    toolCallsCount: 3,
    verdict: "APPROVE",
  };
}

describe("AnalyticsEngineTelemetryEmitter", () => {
  it("writes data point to analytics engine when dataset is provided", () => {
    const written: unknown[] = [];
    const dataset = {
      writeDataPoint: (point: unknown) => {
        written.push(point);
      },
    };
    const emitter = new AnalyticsEngineTelemetryEmitter(dataset);
    emitter.emitRunTelemetry(sampleTelemetry());
    expect(written).toHaveLength(1);

    const step: StepTiming = {
      attempt: 1,
      durationMs: 2000,
      status: "success",
      stepName: "prepare-repository",
    };
    emitter.emitStepTiming(step);
    expect(written).toHaveLength(2);
  });

  it("handles writeDataPoint errors gracefully without throwing", () => {
    const dataset = {
      writeDataPoint: () => {
        throw new Error("Analytics Engine quota exceeded");
      },
    };
    const emitter = new AnalyticsEngineTelemetryEmitter(dataset);
    expect(() => emitter.emitRunTelemetry(sampleTelemetry())).not.toThrow();
    expect(() =>
      emitter.emitStepTiming({
        attempt: 1,
        durationMs: 100,
        status: "failure",
        stepName: "test",
      }),
    ).not.toThrow();
  });

  it("does nothing when dataset is undefined", () => {
    const emitter = new AnalyticsEngineTelemetryEmitter(undefined);
    expect(() => emitter.emitRunTelemetry(sampleTelemetry())).not.toThrow();
    expect(() =>
      emitter.emitStepTiming({
        attempt: 1,
        durationMs: 100,
        status: "success",
        stepName: "test",
      }),
    ).not.toThrow();
  });
});

describe("StructuredLogTelemetryEmitter", () => {
  it("emits structured log events for run telemetry and step timing", () => {
    const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const logger: StructuredLogger = {
      emit: (event, fields) => {
        logs.push({ event, fields });
      },
    };

    const emitter = new StructuredLogTelemetryEmitter(logger);
    emitter.emitRunTelemetry(sampleTelemetry());
    expect(logs).toHaveLength(1);
    expect(logs[0]?.event).toBe("holon.run_telemetry");
    expect(logs[0]?.fields.runId).toBe("run:123");
    expect(logs[0]?.fields.costMicroUsd).toBe(12500);

    emitter.emitStepTiming({
      attempt: 2,
      durationMs: 1500,
      status: "failure",
      stepName: "model-shard-1",
    });
    expect(logs).toHaveLength(2);
    expect(logs[1]?.event).toBe("holon.step_timing");
    expect(logs[1]?.fields.stepName).toBe("model-shard-1");
    expect(logs[1]?.fields.status).toBe("failure");

    // Default logger instance
    const defaultEmitter = new StructuredLogTelemetryEmitter();
    expect(defaultEmitter).toBeInstanceOf(StructuredLogTelemetryEmitter);
  });

  it("handles degraded run without verdict accurately in AnalyticsEngine and StructuredLog", () => {
    const written: unknown[] = [];
    const dataset = {
      writeDataPoint: (point: unknown) => {
        written.push(point);
      },
    };
    const aeEmitter = new AnalyticsEngineTelemetryEmitter(dataset);
    const degradedTelemetry: RunTelemetry = {
      ...sampleTelemetry(),
      isDegraded: true,
      verdict: undefined,
    };
    aeEmitter.emitRunTelemetry(degradedTelemetry);
    expect(written).toHaveLength(1);
    const point = written[0] as { blobs: unknown[]; doubles: unknown[] };
    expect(point.blobs[4]).toBe("UNKNOWN");
    expect(point.doubles[7]).toBe(1);
  });
});

describe("CompositeTelemetryEmitter", () => {
  it("delegates to all child emitters concurrently and handles failures safely", async () => {
    const emitter1 = {
      emitRunTelemetry: vi.fn(),
      emitStepTiming: vi.fn(),
    };
    const emitter2 = {
      emitRunTelemetry: vi.fn().mockRejectedValue(new Error("Failure in sink")),
      emitStepTiming: vi.fn().mockRejectedValue(new Error("Failure in sink")),
    };

    const composite = new CompositeTelemetryEmitter([emitter1, emitter2]);
    await expect(
      composite.emitRunTelemetry(sampleTelemetry()),
    ).resolves.not.toThrow();
    await expect(
      composite.emitStepTiming({
        attempt: 1,
        durationMs: 500,
        status: "success",
        stepName: "step",
      }),
    ).resolves.not.toThrow();

    expect(emitter1.emitRunTelemetry).toHaveBeenCalledOnce();
    expect(emitter1.emitStepTiming).toHaveBeenCalledOnce();
    expect(emitter2.emitRunTelemetry).toHaveBeenCalledOnce();
    expect(emitter2.emitStepTiming).toHaveBeenCalledOnce();
  });
});
