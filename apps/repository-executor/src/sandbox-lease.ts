import {
  repositoryDeadlineSchema,
  repositoryExecutionLimits,
} from "@holon/contracts";

export interface LeaseState {
  readonly deadlineAt: number;
  readonly closed: boolean;
  readonly cleanupAttempts: number;
}
interface LeaseHooks {
  now(): number;
  load(): Promise<LeaseState | undefined>;
  save(state: LeaseState): Promise<void>;
  schedule(deadlineAt: number): Promise<void>;
  keepAlive(enabled: boolean): Promise<void>;
  destroy(): Promise<void>;
  cancelSchedules(): void;
}

/** Serialized in the owning DO; deadlines survive eviction and alarms are fenced. */
export class SandboxLease {
  private pending = Promise.resolve();
  constructor(private readonly hooks: LeaseHooks) {}

  private serial(action: () => Promise<void>): Promise<void> {
    const pending = this.pending.then(action);
    this.pending = pending.catch(() => {});
    return pending;
  }

  acquire(rawDeadlineAt: number): Promise<void> {
    return this.serial(async () => {
      const deadlineAt = repositoryDeadlineSchema.parse(rawDeadlineAt);
      const remaining = deadlineAt - this.hooks.now();
      if (remaining <= 0 || remaining > repositoryExecutionLimits.leaseMs)
        throw new TypeError("Invalid sandbox lease deadline");
      const previous = await this.hooks.load();
      if (previous?.closed) throw new Error("Sandbox lease is closed");
      const effectiveDeadline = Math.max(previous?.deadlineAt ?? 0, deadlineAt);
      // Schedule before enabling keep-alive: a failed admission cannot orphan it.
      await this.hooks.schedule(effectiveDeadline);
      await this.hooks.save({
        deadlineAt: effectiveDeadline,
        closed: false,
        cleanupAttempts: 0,
      });
      await this.hooks.keepAlive(true);
    });
  }

  async assertActive(deadlineAt: number): Promise<void> {
    repositoryDeadlineSchema.parse(deadlineAt);
    const state = await this.hooks.load();
    if (
      !state ||
      state.closed ||
      deadlineAt > state.deadlineAt ||
      deadlineAt <= this.hooks.now()
    )
      throw new Error("No active sandbox lease for operation");
  }

  expire(): Promise<void> {
    return this.serial(async () => {
      const state = await this.hooks.load();
      if (!state || state.deadlineAt > this.hooks.now()) return;
      await this.cleanup(state);
    });
  }

  private async cleanup(state: LeaseState): Promise<void> {
    await this.hooks.save({
      ...state,
      cleanupAttempts: state.cleanupAttempts + 1,
    });
    // The SDK consumes scheduled callbacks even on failure; arrange a bounded-backoff retry first.
    const delay = Math.min(
      300_000,
      repositoryExecutionLimits.cleanupMs *
        2 ** Math.min(state.cleanupAttempts, 6),
    );
    await this.hooks.schedule(this.hooks.now() + delay);
    await this.hooks.keepAlive(false);
    await this.hooks.destroy();
    this.hooks.cancelSchedules();
  }

  close(): Promise<void> {
    return this.serial(async () => {
      const previous = await this.hooks.load();
      await this.cleanup({
        deadlineAt: this.hooks.now(),
        closed: true,
        cleanupAttempts: previous?.cleanupAttempts ?? 0,
      });
    });
  }
}
