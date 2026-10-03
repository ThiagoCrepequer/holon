import {
  reviewExecutionLimits,
  reviewInvestigationLimits,
  runIdSchema,
} from "@holon/contracts";

import { consoleLogger, type StructuredLogger } from "./observability.js";
/** Durable reservations enforce tool limits across retries and eviction. */
export class ReviewToolBudgetStore {
  public constructor(
    private readonly sql: SqlStorage,
    private readonly logger: StructuredLogger = consoleLogger,
  ) {}
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
      .exec<{ total: number; shard: number }>(
        "SELECT COALESCE(SUM(calls),0) AS total, COALESCE(SUM(CASE WHEN shard_index = ? THEN calls ELSE 0 END),0) AS shard FROM review_tool_budgets WHERE run_id = ?",
        index,
        runId,
      )
      .toArray()[0]!;
    const totalLimit = reviewInvestigationLimits.toolCalls * totalShards;
    const totalExceeded = row.total >= totalLimit;
    const shardExceeded = row.shard >= reviewInvestigationLimits.toolCalls;
    if (totalExceeded || shardExceeded) {
      try {
        this.logger.emit("repository.tool_budget_rejected", {
          severity: "error",
          runId,
          shardIndex: index,
          rule: shardExceeded ? "shard_calls" : "run_calls",
          shardCurrent: row.shard,
          shardLimit: reviewInvestigationLimits.toolCalls,
          totalCurrent: row.total,
          totalLimit,
          shardExceeded,
          totalExceeded,
        });
      } catch {
        // Logging cannot change the durable tool budget decision.
      }
      return false;
    }
    this.sql.exec(
      "INSERT INTO review_tool_budgets(run_id,shard_index,calls) VALUES (?,?,1) ON CONFLICT(run_id,shard_index) DO UPDATE SET calls = calls + 1",
      runId,
      index,
    );
    return true;
  }
}
