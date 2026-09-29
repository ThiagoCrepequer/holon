import {
  modelGenerationLimits,
  modelGenerationReservationSchema,
  runIdSchema,
  type ModelGenerationReservation,
} from "@holon/contracts";

/** Call only inside the ledger transaction. Uncertain calls retain their full reservation. */
export class ReviewGenerationBudgetStore {
  public constructor(private readonly sql: SqlStorage) {}
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
    if (
      totals.calls >= modelGenerationLimits.calls ||
      totals.input + request.inputBytes > modelGenerationLimits.inputBytes ||
      totals.output + request.outputTokens > modelGenerationLimits.outputTokens
    )
      return undefined;
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
