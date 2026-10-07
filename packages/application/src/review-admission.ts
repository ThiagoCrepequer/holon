import {
  maximumBudgetedReviewShards,
  reviewPlanSchema,
  type ReviewPlan,
} from "@holon/contracts";

/** Admit complete shard lifecycles before dispatch; retain all coverage omissions. */
export function admitReviewPlan(plan: ReviewPlan): ReviewPlan {
  if (plan.shards.length <= maximumBudgetedReviewShards) return plan;
  const shards = plan.shards.slice(0, maximumBudgetedReviewShards);
  return reviewPlanSchema.parse({
    ...plan,
    scopeStatus: "partial_by_policy",
    omissionReasons: [
      ...plan.omissionReasons,
      {
        code: "model_budget",
        maximum: shards.length,
        planned: plan.shards.length,
      },
    ],
    shards: shards.map((shard) => ({ ...shard, totalShards: shards.length })),
  });
}
