import { z } from "zod";

/** These are host budgets, never values supplied by the model. */
export const repositoryExecutionLimits = {
  toolMs: 90_000,
  leaseMs: 17 * 60_000,
  cleanupMs: 5_000,
} as const;
export const repositoryDeadlineSchema = z.number().int().positive().safe();

export interface RepositoryToolOperation {
  result(): Promise<{ content: string; truncated: boolean }>;
  cancel(): Promise<void>;
  [Symbol.dispose](): void;
}
