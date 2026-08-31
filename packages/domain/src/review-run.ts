import type { PrKey, RunId } from "./identity.js";

export const runStates = [
  "queued",
  "running",
  "publishing",
  "completed",
  "obsolete",
  "failed_retryable",
  "failed_terminal",
] as const;

export type RunState = (typeof runStates)[number];

export interface ReviewRun {
  readonly attempt: number;
  readonly causalVersion?: string;
  readonly createdAt: string;
  readonly id: RunId;
  readonly prKey: PrKey;
  readonly state: RunState;
  readonly updatedAt?: string;
}

const transitions = {
  completed: [],
  failed_retryable: ["running", "failed_terminal"],
  failed_terminal: [],
  obsolete: [],
  publishing: ["completed", "failed_retryable", "obsolete"],
  queued: ["running", "obsolete"],
  running: ["publishing", "failed_retryable", "obsolete"],
} as const satisfies Record<RunState, readonly RunState[]>;

export class InvalidRunTransitionError extends Error {
  public constructor(from: RunState, to: RunState) {
    super(`Invalid review run transition: ${from} -> ${to}`);
    this.name = "InvalidRunTransitionError";
  }
}

export function canTransitionRun(from: RunState, to: RunState): boolean {
  return (transitions[from] as readonly RunState[]).includes(to);
}

export function isTerminalRunState(state: RunState): boolean {
  return transitions[state].length === 0;
}

export function transitionRun(
  run: ReviewRun,
  to: RunState,
  occurredAt: string,
): ReviewRun {
  if (!canTransitionRun(run.state, to)) {
    throw new InvalidRunTransitionError(run.state, to);
  }

  return {
    ...run,
    attempt: to === "running" ? run.attempt + 1 : run.attempt,
    state: to,
    updatedAt: occurredAt,
  };
}
