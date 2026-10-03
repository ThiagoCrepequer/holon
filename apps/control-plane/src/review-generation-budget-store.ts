import {
  modelGenerationLimits,
  modelGenerationReservationSchema,
  runIdSchema,
  type ModelGenerationReservation,
} from "@holon/contracts";

import { consoleLogger, type StructuredLogger } from "./observability.js";

/** Call only inside the ledger transaction. Uncertain calls retain their full reservation. */
export class ReviewGenerationBudgetStore {
  public constructor(
    private readonly sql: SqlStorage,
    private readonly logger: StructuredLogger = consoleLogger,
  ) {}
  public reserve(
    rawRunId: string,
    raw: ModelGenerationReservation,
  ): number | undefined {
    const runId = runIdSchema.parse(rawRunId);
    const request = modelGenerationReservationSchema.parse(raw);
    if (
      !this.sql.exec("SELECT 1 FROM runs WHERE id = ?", runId).toArray().length
    )
      throw new Error("Model budget run is unavailable");
    const totals = this.sql
      .exec<{ calls: number; input: number; output: number }>(
        "SELECT COUNT(*) AS calls, COALESCE(SUM(input_bytes),0) AS input, COALESCE(SUM(output_tokens),0) AS output FROM model_generation_reservations WHERE run_id = ?",
        runId,
      )
      .one();
    const callsExceeded = totals.calls >= modelGenerationLimits.calls;
    const inputBytesExceeded =
      totals.input + request.inputBytes > modelGenerationLimits.inputBytes;
    const outputTokensExceeded =
      totals.output + request.outputTokens > modelGenerationLimits.outputTokens;
    if (callsExceeded || inputBytesExceeded || outputTokensExceeded) {
      const rule = callsExceeded
        ? "calls"
        : inputBytesExceeded
          ? "input_bytes"
          : "output_tokens";
      const current =
        rule === "calls"
          ? totals.calls
          : rule === "input_bytes"
            ? totals.input
            : totals.output;
      const requested =
        rule === "calls"
          ? 1
          : rule === "input_bytes"
            ? request.inputBytes
            : request.outputTokens;
      const limit =
        rule === "calls"
          ? modelGenerationLimits.calls
          : rule === "input_bytes"
            ? modelGenerationLimits.inputBytes
            : modelGenerationLimits.outputTokens;
      try {
        this.logger.emit("model.budget_rejected", {
          severity: "error",
          runId,
          rule,
          current,
          requested,
          limit,
          callsCurrent: totals.calls,
          callsExceeded,
          callsLimit: modelGenerationLimits.calls,
          callsRequested: 1,
          inputBytesCurrent: totals.input,
          inputBytesExceeded,
          inputBytesLimit: modelGenerationLimits.inputBytes,
          inputBytesRequested: request.inputBytes,
          outputTokensCurrent: totals.output,
          outputTokensExceeded,
          outputTokensLimit: modelGenerationLimits.outputTokens,
          outputTokensRequested: request.outputTokens,
        });
      } catch {
        // Logging cannot alter admission or transactional accounting.
      }
      return undefined;
    }
    return this.sql
      .exec<{ id: number }>(
        "INSERT INTO model_generation_reservations(run_id,input_bytes,output_tokens) VALUES (?,?,?) RETURNING id",
        runId,
        request.inputBytes,
        request.outputTokens,
      )
      .one().id;
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
