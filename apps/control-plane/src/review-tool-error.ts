import type { RepositoryToolFailure } from "@holon/contracts";

/** Only closed, validated codes may become SDK tool-error text. */
export class RepositoryToolResponseError extends Error {
  constructor(readonly failure: RepositoryToolFailure) {
    super(failure.code);
    this.name = "RepositoryToolResponseError";
  }
}
