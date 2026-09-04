import type { TelemetryEmitter } from "@holon/application";
import type { RunTelemetry, StepTiming } from "@holon/contracts";

import { consoleLogger, type StructuredLogger } from "./observability.js";

export class AnalyticsEngineTelemetryEmitter implements TelemetryEmitter {
  public constructor(private readonly dataset?: AnalyticsEngineDataset) {}

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
    } catch {
      // Graceful fallback: never let telemetry emission disrupt review execution
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
    } catch {
      // Graceful fallback
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
  public constructor(private readonly emitters: readonly TelemetryEmitter[]) {}

  public async emitRunTelemetry(telemetry: RunTelemetry): Promise<void> {
    await Promise.allSettled(
      this.emitters.map((emitter) =>
        Promise.resolve(emitter.emitRunTelemetry(telemetry)),
      ),
    );
  }

  public async emitStepTiming(step: StepTiming): Promise<void> {
    await Promise.allSettled(
      this.emitters.map((emitter) =>
        Promise.resolve(emitter.emitStepTiming(step)),
      ),
    );
  }
}
