import { reviewPlanSchema, type ReviewPlan } from "@holon/contracts";

/** Structural admission already enforces 64 parts. Profiles fund all admitted work. */
export function admitReviewPlan(plan: ReviewPlan): ReviewPlan {
  reviewPlanSchema.parse(plan);
  return plan;
}
