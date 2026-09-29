import {
  repositoryDeadlineSchema,
  repositoryExecutionLimits,
} from "@holon/contracts";

import { SandboxRuntimeError } from "./sandbox-errors.js";

/** Owns cancellation across every tool sub-operation, including queued RPCs. */
export class ToolExecution {
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  readonly deadlineAt: number;
  constructor(
    deadlineAt: number,
    private readonly retain: (work: Promise<unknown>) => void,
    private readonly observe: (fields: {
      stage: string;
      durationMs: number;
      outcome: string;
    }) => void = () => {},
  ) {
    this.deadlineAt = repositoryDeadlineSchema.parse(deadlineAt);
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0 || remaining > repositoryExecutionLimits.toolMs)
      throw new SandboxRuntimeError(true, "timed-out");
    this.timer = setTimeout(() => this.cancel(), remaining);
  }
  get signal(): AbortSignal {
    return this.controller.signal;
  }
  check(): void {
    if (Date.now() >= this.deadlineAt) this.cancel();
    this.signal.throwIfAborted();
  }
  cancel(): void {
    this.controller.abort(new SandboxRuntimeError(true, "timed-out"));
  }
  dispose(): void {
    clearTimeout(this.timer);
  }

  async cleanup(start: () => Promise<unknown>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = Promise.resolve()
      .then(start)
      .catch(() => {});
    this.retain(pending);
    try {
      await Promise.race([
        pending,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, repositoryExecutionLimits.cleanupMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async wait<T>(
    start: () => Promise<T>,
    discard?: (value: T) => Promise<unknown>,
    stage = "tool_operation",
  ): Promise<T> {
    const startedAt = Date.now();
    this.check();
    let abort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      abort = () => reject(this.signal.reason);
      this.signal.addEventListener("abort", abort, { once: true });
    });
    const pending = Promise.resolve()
      .then(() => {
        this.check();
        return start();
      })
      .then(async (value) => {
        if (this.signal.aborted || Date.now() >= this.deadlineAt) {
          if (discard) await discard(value);
          this.cancel();
          throw this.signal.reason;
        }
        return value;
      });
    // A late process handle must still be killed, even after its RPC caller leaves.
    this.retain(pending.catch(() => {}));
    let outcome = "succeeded";
    try {
      return await Promise.race([pending, aborted]);
    } catch (error) {
      outcome = this.signal.aborted ? "cancelled" : "failed";
      throw error;
    } finally {
      this.signal.removeEventListener("abort", abort);
      try {
        this.observe({
          stage,
          durationMs: Date.now() - startedAt,
          outcome,
        });
      } catch {
        /* Advisory metadata must not alter execution. */
      }
    }
  }
}
