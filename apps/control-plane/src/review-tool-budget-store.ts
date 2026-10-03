import {
  reviewExecutionLimits,
  reviewInvestigationLimits,
  runIdSchema,
} from "@holon/contracts";
/** Durable reservations enforce tool limits across retries and eviction. */
export class ReviewToolBudgetStore {
  public constructor(private readonly sql: SqlStorage) {}
  public reserveToolCall(
    rawRunId: string,
    index: number,
    totalShards: number,
  ): boolean {
    const runId = runIdSchema.parse(rawRunId);
    if (
      !Number.isSafeInteger(index) ||
      !Number.isSafeInteger(totalShards) ||
      index < 0 ||
      index >= totalShards ||
      totalShards > reviewExecutionLimits.maxShards
    )
      throw new TypeError("Invalid shard allocation");
    if (
      !this.sql.exec("SELECT 1 FROM runs WHERE id = ?", runId).toArray().length
    )
      throw new Error("Tool budget run is unavailable");
    const row = this.sql
      .exec<{ total: number }>(
        "SELECT COALESCE(SUM(calls),0) AS total FROM review_tool_budgets WHERE run_id = ?",
        runId,
      )
      .toArray()[0]!;
    if (row.total >= reviewInvestigationLimits.toolCalls) return false;
    this.sql.exec(
      "INSERT INTO review_tool_budgets(run_id,shard_index,calls) VALUES (?,?,1) ON CONFLICT(run_id,shard_index) DO UPDATE SET calls = calls + 1",
      runId,
      index,
    );
    return true;
  }
}
