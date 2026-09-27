import type { TelemetryEmitter } from "@holon/application";
import type { RunTelemetry, StepTiming } from "@holon/contracts";
import {
  consoleErrorReporter,
  reportError,
  type ErrorReporter,
} from "@holon/observability";

import { consoleLogger, type StructuredLogger } from "./observability.js";

export class AnalyticsEngineTelemetryEmitter implements TelemetryEmitter {
  public constructor(
    private readonly dataset?: AnalyticsEngineDataset,
    private readonly reporter: ErrorReporter = consoleErrorReporter,
  ) {}

  public emitRunTelemetry(telemetry: RunTelemetry): void {
    if (!this.dataset) return;
    try {
      this.dataset.writeDataPoint({
        blobs: [
          telemetry.runId,
          telemetry.cost.pricingModel,
          telemetry.terminalState,
          telemetry.scopeStatus,
          telemetry.verdict ?? "UNKNOWN",
          telemetry.prKey,
          telemetry.policySource ?? null,
          telemetry.effectivePolicyDigest ?? null,
          telemetry.sourceDigest ?? null,
        ],
        doubles: [
          telemetry.durationMs,
          telemetry.queueWaitMs,
          telemetry.tokens.inputTokens,
          telemetry.tokens.outputTokens,
          telemetry.cost.estimatedCostMicroUsd,
          telemetry.toolCallsCount,
          telemetry.shardsCount,
          telemetry.isDegraded ? 1 : 0,
        ],
        indexes: [telemetry.prKey],
      });
    } catch (error) {
      reportError(this.reporter, "telemetry.analytics_write_failed", error, {
        component: "control-plane",
        operation: "telemetry.run",
        runId: telemetry.runId,
      });
    }
  }

  public emitStepTiming(step: StepTiming): void {
    if (!this.dataset) return;
    try {
      this.dataset.writeDataPoint({
        blobs: [step.stepName, step.status],
        doubles: [step.durationMs, step.attempt],
        indexes: [step.stepName],
      });
    } catch (error) {
      reportError(this.reporter, "telemetry.analytics_write_failed", error, {
        component: "control-plane",
        operation: "telemetry.step",
        stepName: step.stepName,
        attempt: step.attempt,
      });
    }
  }
}

export class StructuredLogTelemetryEmitter implements TelemetryEmitter {
  public constructor(
    private readonly logger: StructuredLogger = consoleLogger,
  ) {}

  public emitRunTelemetry(telemetry: RunTelemetry): void {
    this.logger.emit("holon.run_telemetry", {
      costMicroUsd: telemetry.cost.estimatedCostMicroUsd,
      costUsd: telemetry.cost.estimatedCostUsd,
      durationMs: telemetry.durationMs,
      effectivePolicyDigest: telemetry.effectivePolicyDigest,
      eventId: `${telemetry.runId}:holon.run_telemetry`,
      headSha: telemetry.headSha,
      inputTokens: telemetry.tokens.inputTokens,
      isDegraded: telemetry.isDegraded,
      outputTokens: telemetry.tokens.outputTokens,
      pricingModel: telemetry.cost.pricingModel,
      policySource: telemetry.policySource,
      prKey: telemetry.prKey,
      queueWaitMs: telemetry.queueWaitMs,
      runId: telemetry.runId,
      scopeStatus: telemetry.scopeStatus ?? undefined,
      ...(telemetry.sourceDigest == null
        ? {}
        : { sourceDigest: telemetry.sourceDigest }),
      shardsCount: telemetry.shardsCount,
      terminalState: telemetry.terminalState,
      toolCallsCount: telemetry.toolCallsCount,
      totalTokens: telemetry.tokens.totalTokens,
      verdict: telemetry.verdict ?? undefined,
    });
  }

  public emitStepTiming(step: StepTiming): void {
    this.logger.emit("holon.step_timing", {
      attempt: step.attempt,
      durationMs: step.durationMs,
      eventId: `${step.stepName}:${step.attempt}:holon.step_timing`,
      status: step.status,
      stepName: step.stepName,
    });
  }
}

export class CompositeTelemetryEmitter implements TelemetryEmitter {
  public constructor(
    private readonly emitters: readonly TelemetryEmitter[],
    private readonly reporter: ErrorReporter = consoleErrorReporter,
  ) {}

  private async emitAll(
    operation: "telemetry.run" | "telemetry.step",
    context: {
      readonly runId?: string;
      readonly stepName?: string;
      readonly attempt?: number;
    },
    invoke: (emitter: TelemetryEmitter) => Promise<void> | void,
  ): Promise<void> {
    const results = await Promise.allSettled(
      this.emitters.map((emitter) =>
        Promise.resolve().then(() => invoke(emitter)),
      ),
    );
    for (const [messageIndex, result] of results.entries()) {
      if (result.status === "rejected") {
        reportError(this.reporter, "telemetry.sink_failed", result.reason, {
          component: "control-plane",
          operation,
          messageIndex,
          ...context,
        });
      }
    }
  }

  public async emitRunTelemetry(telemetry: RunTelemetry): Promise<void> {
    await this.emitAll("telemetry.run", { runId: telemetry.runId }, (emitter) =>
      emitter.emitRunTelemetry(telemetry),
    );
  }

  public async emitStepTiming(step: StepTiming): Promise<void> {
    await this.emitAll(
      "telemetry.step",
      { stepName: step.stepName, attempt: step.attempt },
      (emitter) => emitter.emitStepTiming(step),
    );
  }
}
