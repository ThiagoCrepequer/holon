import {
  reviewBudgetProfiles,
  modelGenerationStopReasonSchema,
  type ModelGenerationStopReason,
  type ModelGenerationAdmission,
  modelGenerationReservationSchema,
  runIdSchema,
  type ModelGenerationReservation,
} from "@holon/contracts";

import { consoleLogger, type StructuredLogger } from "../observability.js";
import { ReviewBudgetPlanStore } from "./review-budget-plan-store.js";

/** Call only inside the ledger transaction. Uncertain calls retain their full reservation. */
export class ReviewGenerationBudgetStore {
  public constructor(
    private readonly sql: SqlStorage,
    private readonly logger: StructuredLogger = consoleLogger,
  ) {}
  public reserve(
    rawRunId: string,
    raw: ModelGenerationReservation,
  ): ModelGenerationAdmission {
    const runId = runIdSchema.parse(rawRunId);
    const request = modelGenerationReservationSchema.parse(raw);
    if (request.shardIndex >= request.shardCount)
      throw new TypeError("Invalid model shard allocation");
    if (
      !this.sql.exec("SELECT 1 FROM runs WHERE id = ?", runId).toArray().length
    )
      throw new Error("Model budget run is unavailable");
    const plans = new ReviewBudgetPlanStore(this.sql);
    const plan = plans.load(runId, request.shardCount);
    const limits = reviewBudgetProfiles[plan.profile];
    const totals = this.sql
      .exec<{ calls: number; input: number; output: number }>(
        "SELECT COUNT(*) AS calls, COALESCE(SUM(input_bytes),0) AS input, COALESCE(SUM(output_tokens),0) AS output FROM model_generation_reservations WHERE run_id=?",
        runId,
      )
      .one();
    const reject = (
      reason: Extract<ModelGenerationAdmission, { accepted: false }>["reason"],
      consumed: number,
      requested: number,
      ceiling: number,
    ): ModelGenerationAdmission => {
      if (!reason.startsWith("shard_"))
        this.sql.exec(
          "UPDATE model_generation_plans SET stop_reason = ? WHERE run_id = ? AND stop_reason IS NULL",
          reason,
          runId,
        );
      try {
        this.logger.emit("model.budget_rejected", {
          severity: "error",
          runId,
          shardIndex: request.shardIndex,
          shardCount: request.shardCount,
          phase: request.phase,
          rule: reason,
          current: consumed,
          requested,
          limit: ceiling,
          callsCurrent: totals.calls,
          callsLimit: limits.calls,
          callsRequested: 1,
          inputBytesCurrent: totals.input,
          inputBytesLimit: limits.inputBytes,
          inputBytesRequested: request.inputBytes,
          outputTokensCurrent: totals.output,
          outputTokensLimit: limits.outputTokens,
          outputTokensRequested: request.outputTokens,
        });
      } catch {
        // Logging cannot alter admission or transactional accounting.
      }
      return {
        accepted: false,
        reason,
        limit: ceiling,
        consumed,
        requested,
      };
    };
    // A request outside its allocation cannot stop peers while the run still has
    // capacity. Already exhausted aggregate ceilings retain global precedence.
    if (
      totals.calls < limits.calls &&
      totals.input < limits.inputBytes &&
      totals.output < limits.outputTokens
    ) {
      const available = {
        calls: plans.available(runId, plan, request.shardIndex, "calls"),
        inputBytes: plans.available(
          runId,
          plan,
          request.shardIndex,
          "inputBytes",
        ),
        outputTokens: plans.available(
          runId,
          plan,
          request.shardIndex,
          "outputTokens",
        ),
      };
      const shard = this.sql
        .exec<{ calls: number; input: number; output: number }>(
          "SELECT COUNT(*) AS calls, COALESCE(SUM(input_bytes),0) AS input, COALESCE(SUM(output_tokens),0) AS output FROM model_generation_reservations WHERE run_id=? AND shard_index=?",
          runId,
          request.shardIndex,
        )
        .one();
      if (available.calls < 1)
        return reject(
          "shard_calls",
          shard.calls,
          1,
          shard.calls + available.calls,
        );
      if (request.inputBytes > available.inputBytes)
        return reject(
          "shard_input_bytes",
          shard.input,
          request.inputBytes,
          shard.input + available.inputBytes,
        );
      if (request.outputTokens > available.outputTokens)
        return reject(
          "shard_output_tokens",
          shard.output,
          request.outputTokens,
          shard.output + available.outputTokens,
        );
    }
    if (totals.calls >= limits.calls)
      return reject("calls", totals.calls, 1, limits.calls);
    if (totals.input + request.inputBytes > limits.inputBytes)
      return reject(
        "input_bytes",
        totals.input,
        request.inputBytes,
        limits.inputBytes,
      );
    if (totals.output + request.outputTokens > limits.outputTokens)
      return reject(
        "output_tokens",
        totals.output,
        request.outputTokens,
        limits.outputTokens,
      );
    const id = this.sql
      .exec<{ id: number }>(
        "INSERT INTO model_generation_reservations(run_id,input_bytes,output_tokens,shard_index) VALUES (?,?,?,?) RETURNING id",
        runId,
        request.inputBytes,
        request.outputTokens,
        request.shardIndex,
      )
      .one().id;
    return { accepted: true, id, outputTokens: request.outputTokens };
  }
  public loadStopReason(
    rawRunId: string,
  ): ModelGenerationStopReason | undefined {
    const runId = runIdSchema.parse(rawRunId);
    const row = this.sql
      .exec<{ stop_reason: string | null }>(
        "SELECT stop_reason FROM model_generation_plans WHERE run_id = ?",
        runId,
      )
      .toArray()[0];
    return row?.stop_reason == null
      ? undefined
      : modelGenerationStopReasonSchema.parse(row.stop_reason);
  }
  public settle(rawRunId: string, id: number, outputTokens: number): void {
    const runId = runIdSchema.parse(rawRunId);
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      !Number.isSafeInteger(outputTokens) ||
      outputTokens < 0
    )
      throw new TypeError("Invalid model settlement");
    // Provider usage may exceed its declared maximum; charge the reported amount.
    this.sql.exec(
      "UPDATE model_generation_reservations SET output_tokens = ?, settled = 1 WHERE id = ? AND run_id = ? AND settled = 0",
      outputTokens,
      id,
      runId,
    );
  }
}
