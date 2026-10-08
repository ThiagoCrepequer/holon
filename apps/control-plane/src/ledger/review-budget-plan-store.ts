import {
  createReviewBudgetPlan,
  reviewBudgetPlanSchema,
  reviewBudgetProfiles,
  reviewShardBudget,
  runIdSchema,
  type ReviewBudgetPlan,
} from "@holon/contracts";

type Dimension = "calls" | "inputBytes" | "outputTokens" | "toolCalls";
/** All operations run inside the PR ledger's transaction. No payload content is persisted. */
export class ReviewBudgetPlanStore {
  public constructor(private readonly sql: SqlStorage) {}
  public configure(rawRunId: string, rawPlan: ReviewBudgetPlan): void {
    const runId = runIdSchema.parse(rawRunId);
    const plan = reviewBudgetPlanSchema.parse(rawPlan);
    if (!this.sql.exec("SELECT 1 FROM runs WHERE id=?", runId).toArray().length)
      throw new Error("Review budget run is unavailable");
    this.sql.exec(
      "INSERT INTO model_generation_plans(run_id,shard_count,budget_json) VALUES (?,?,?) ON CONFLICT(run_id) DO NOTHING",
      runId,
      plan.shardWeights.length,
      JSON.stringify(plan),
    );
    const saved = this.sql
      .exec<{ budget_json: string | null }>(
        "SELECT budget_json FROM model_generation_plans WHERE run_id=?",
        runId,
      )
      .one();
    if (saved.budget_json !== JSON.stringify(plan))
      throw new Error("Review budget plan changed");
  }
  public load(runId: string, shardCount: number): ReviewBudgetPlan {
    // Direct ledger callers can initialize a count-based plan. Production planning
    // freezes the prompt estimate and risk weights before any inference or tool call.
    const row = this.sql
      .exec<{ budget_json: string | null }>(
        "SELECT budget_json FROM model_generation_plans WHERE run_id=?",
        runId,
      )
      .toArray()[0];
    if (!row) this.configure(runId, createReviewBudgetPlan(shardCount));
    const saved = this.sql
      .exec<{ budget_json: string | null }>(
        "SELECT budget_json FROM model_generation_plans WHERE run_id=?",
        runId,
      )
      .one();
    if (saved.budget_json === null)
      throw new Error("Review budget requires replanning");
    const plan = reviewBudgetPlanSchema.parse(JSON.parse(saved.budget_json));
    if (plan.shardWeights.length !== shardCount)
      throw new Error("Model budget plan changed");
    return plan;
  }
  public isComplete(runId: string, index: number): boolean {
    if (!Number.isSafeInteger(index) || index < 0 || index > 63)
      throw new TypeError("Invalid completed review shard");
    return (
      this.sql
        .exec(
          "SELECT 1 FROM review_budget_completions WHERE run_id=? AND shard_index=?",
          runId,
          index,
        )
        .toArray().length > 0
    );
  }
  public complete(rawRunId: string, index: number): void {
    const runId = runIdSchema.parse(rawRunId);
    const row = this.sql
      .exec<{ shard_count: number }>(
        "SELECT shard_count FROM model_generation_plans WHERE run_id=?",
        runId,
      )
      .toArray()[0];
    if (
      !row ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= row.shard_count
    )
      throw new TypeError("Invalid completed review shard");
    this.sql.exec(
      "INSERT INTO review_budget_completions(run_id,shard_index) VALUES (?,?) ON CONFLICT DO NOTHING",
      runId,
      index,
    );
  }
  public available(
    runId: string,
    plan: ReviewBudgetPlan,
    index: number,
    dimension: Dimension,
  ): number {
    const limits = reviewBudgetProfiles[plan.profile];
    const usage = new Map<number, number>();
    const rows =
      dimension === "toolCalls"
        ? this.sql
            .exec<{ shard_index: number; used: number }>(
              "SELECT shard_index, calls AS used FROM review_tool_budgets WHERE run_id=?",
              runId,
            )
            .toArray()
        : this.sql
            .exec<{ shard_index: number; used: number }>(
              `SELECT shard_index, ${dimension === "calls" ? "COUNT(*)" : dimension === "inputBytes" ? "SUM(input_bytes)" : "SUM(output_tokens)"} AS used FROM model_generation_reservations WHERE run_id=? GROUP BY shard_index`,
              runId,
            )
            .toArray();
    for (const row of rows) usage.set(row.shard_index, row.used);
    const completed = new Set(
      this.sql
        .exec<{ shard_index: number }>(
          "SELECT shard_index FROM review_budget_completions WHERE run_id=?",
          runId,
        )
        .toArray()
        .map((row) => row.shard_index),
    );
    if (completed.has(index)) return 0;
    let released = 0;
    let protectedPeers = 0;
    for (let peer = 0; peer < plan.shardWeights.length; peer++) {
      if (peer === index) continue;
      const budget = reviewShardBudget(plan, peer);
      const used = usage.get(peer) ?? 0;
      if (completed.has(peer))
        released += Math.max(0, budget.allocation[dimension] - used);
      else
        protectedPeers += Math.max(0, budget.protectedBudget[dimension] - used);
    }
    const ownUsed = usage.get(index) ?? 0;
    const totalUsed = [...usage.values()].reduce((sum, used) => sum + used, 0);
    return Math.max(
      0,
      Math.min(
        reviewShardBudget(plan, index).allocation[dimension] +
          released -
          ownUsed,
        limits[dimension] - totalUsed - protectedPeers,
      ),
    );
  }
}
