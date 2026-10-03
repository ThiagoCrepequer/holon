/** A fixed wave deadline leaves time for host validation and publication. */
export const reviewTimeBudget = {
  analysisMs: 17 * 60_000,
  workflowStepMs: 19 * 60_000,
} as const;
