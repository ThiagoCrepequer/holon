import type { ReviewJob } from "@holon/contracts";
import { reviewTimeBudget } from "@holon/model";

import { githubRetryDelay } from "./github-operations.js";

export const stateStep = {
  retries: { backoff: "exponential", delay: "1 second", limit: 3 },
  timeout: "30 seconds",
} as const;

export const repositoryStep = {
  retries: { backoff: "exponential", delay: "5 seconds", limit: 2 },
  timeout: "2 minutes",
} as const;

export const modelStep = {
  retries: { backoff: "constant", delay: "1 second", limit: 0 },
  sensitive: "output",
  timeout: reviewTimeBudget.workflowStepMs,
} as const;

export const publicationStep = {
  retries: { delay: githubRetryDelay, limit: 4 },
  timeout: "2 minutes",
} as const;

export function causalVersionForJob(job: ReviewJob): string {
  return job.envelope.pullRequest.updatedAt;
}

export function durationFrom(startedAt: Date, completedAt: string): number {
  return Math.max(0, Date.parse(completedAt) - startedAt.getTime());
}

export function eventId(
  workflowInstanceId: string,
  event: string,
  suffix?: string | number,
): string {
  return `${workflowInstanceId}:${event}${suffix === undefined ? "" : `:${suffix}`}`;
}

export const configurationStep = {
  retries: { delay: githubRetryDelay, limit: 2 },
  timeout: "2 minutes",
} as const;
