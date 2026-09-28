export type SandboxFailureReason =
  | "command-failed"
  | "timed-out"
  | "unavailable";

export class SandboxRuntimeError extends Error {
  public constructor(
    public readonly retryable: boolean,
    public readonly reason: SandboxFailureReason,
  ) {
    super(`HOLON_SANDBOX_${retryable ? "TRANSIENT" : "PERMANENT"}:${reason}`);
    this.name = "SandboxRuntimeError";
  }
}

export type RepositoryPreparationStage =
  | "block-egress"
  | "checkout"
  | "configure-egress"
  | "diff"
  | "merge-base"
  | "fetch"
  | "initialize"
  | "prepare-context";

export class RepositoryPreparationError extends Error {
  public constructor(
    public readonly retryable: boolean,
    public readonly stage: RepositoryPreparationStage,
    reason:
      | "command-failed"
      | "terminated"
      | "timed-out"
      | "unavailable"
      | "size-limit"
      | "integrity-failed"
      | "history-incomplete",
  ) {
    super(
      `${retryable ? "HOLON_REPOSITORY_TRANSIENT" : "HOLON_REPOSITORY_PERMANENT"}:${stage}:${reason}`,
    );
    this.name = retryable
      ? "RepositoryTransientError"
      : "RepositoryPermanentError";
  }
}
