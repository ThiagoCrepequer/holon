import {
  reviewExecutionLimits,
  reviewInvestigationLimits,
  runIdSchema,
} from "@holon/contracts";

import { consoleLogger, type StructuredLogger } from "../observability.js";
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
    this.sql.exec(
      "INSERT INTO review_tool_plans(run_id,shard_count) VALUES (?,?) ON CONFLICT(run_id) DO NOTHING",
      runId,
      totalShards,
    );
    if (
      this.sql
        .exec<{ shard_count: number }>(
          "SELECT shard_count FROM review_tool_plans WHERE run_id=?",
          runId,
        )
        .one().shard_count !== totalShards
    )
      throw new Error("Tool budget plan changed");
    const protectedCalls = Math.max(
      1,
      Math.floor(reviewInvestigationLimits.toolCalls / (totalShards * 2)),
    );
    const row = this.sql
      .exec<{ total: number; shard: number; otherProtected: number }>(
        "SELECT COALESCE(SUM(calls),0) AS total, COALESCE(SUM(CASE WHEN shard_index = ? THEN calls ELSE 0 END),0) AS shard, COALESCE(SUM(CASE WHEN shard_index != ? THEN MIN(calls,?) ELSE 0 END),0) AS otherProtected FROM review_tool_budgets WHERE run_id = ?",
        index,
        index,
        protectedCalls,
        runId,
      )
      .toArray()[0]!;
    const protectedRemaining =
      (totalShards - 1) * protectedCalls - row.otherProtected;
    if (row.total + protectedRemaining >= reviewInvestigationLimits.toolCalls) {
      try {
        this.logger.emit("repository.tool_budget_rejected", {
          severity: "error",
          runId,
          shardIndex: index,
          rule:
            row.total >= reviewInvestigationLimits.toolCalls
              ? "run_calls"
              : "peer_protection",
          shardCurrent: row.shard,
          totalCurrent: row.total,
          totalLimit: reviewInvestigationLimits.toolCalls,
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
