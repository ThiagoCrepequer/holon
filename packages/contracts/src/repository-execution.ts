import { z } from "zod";

import { repositoryToolResultSchema } from "./executor.js";

/** These are host budgets, never values supplied by the model. */
export const repositoryExecutionLimits = {
  toolMs: 90_000,
  leaseMs: 17 * 60_000,
  cleanupMs: 5_000,
} as const;
export const repositoryDeadlineSchema = z.number().int().positive().safe();

export interface RepositoryToolOperation {
  result(): Promise<RepositoryToolOutcome>;
  cancel(): Promise<void>;
  [Symbol.dispose](): void;
}

/** Safe RPC errors; never transport arbitrary exception messages to the model. */
export const repositoryToolFailureSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("query"),
      code: z.enum(["path_unavailable", "path_denied", "query_unsupported"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("infrastructure"),
      code: z.enum([
        "repository_tool_timeout",
        "repository_unavailable",
        "repository_tool_failed",
      ]),
    })
    .strict(),
]);
export const repositoryToolOutcomeSchema = z.union([
  repositoryToolResultSchema,
  z.object({ error: repositoryToolFailureSchema }).strict(),
]);
export type RepositoryToolOutcome = z.infer<typeof repositoryToolOutcomeSchema>;
export type RepositoryToolFailure = z.infer<typeof repositoryToolFailureSchema>;
