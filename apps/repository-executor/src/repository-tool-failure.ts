import type { RepositoryToolFailure } from "@holon/contracts";

import { SandboxRuntimeError } from "./sandbox-errors.js";

export class RepositoryQueryError extends Error {
  constructor(
    readonly code: Extract<RepositoryToolFailure, { kind: "query" }>["code"],
  ) {
    super(code);
    this.name = "RepositoryQueryError";
  }
}
export function repositoryToolFailure(error: unknown): RepositoryToolFailure {
  if (error instanceof RepositoryQueryError)
    return { kind: "query", code: error.code };
  return {
    kind: "infrastructure",
    code:
      error instanceof SandboxRuntimeError
        ? error.reason === "timed-out"
          ? "repository_tool_timeout"
          : "repository_unavailable"
        : "repository_tool_failed",
  };
}
