import { expect, it } from "vitest";

import { reviewTimeBudget } from "../src/review-budgets.js";

it("keeps the workflow step longer than the analysis deadline", () => {
  expect(reviewTimeBudget.workflowStepMs).toBeGreaterThan(
    reviewTimeBudget.analysisMs,
  );
});
