import type {
  RepositoryToolOperation,
  RepositoryToolOutcome,
} from "@holon/contracts";
import { RpcTarget } from "cloudflare:workers";

import { repositoryToolFailure } from "./repository-tool-failure.js";
import type { ToolExecution } from "./tool-execution.js";

export class RepositoryToolTask
  extends RpcTarget
  implements RepositoryToolOperation
{
  private pending?: Promise<RepositoryToolOutcome>;
  constructor(
    private readonly execution: ToolExecution,
    private readonly execute: () => Promise<{
      content: string;
      truncated: boolean;
    }>,
  ) {
    super();
  }
  result(): Promise<RepositoryToolOutcome> {
    this.pending ??= Promise.resolve()
      .then(() => {
        this.execution.check();
        return this.execute();
      })
      .catch((error: unknown) => ({ error: repositoryToolFailure(error) }))
      .finally(() => this.execution.dispose());
    return this.pending;
  }
  async cancel(): Promise<void> {
    this.execution.cancel();
    await this.pending?.catch(() => {});
    this.execution.dispose();
  }
  [Symbol.dispose](): void {
    this.execution.cancel();
    this.execution.dispose();
  }
}
