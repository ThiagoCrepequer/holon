import type { RepositoryToolOperation } from "@holon/contracts";
import { RpcTarget } from "cloudflare:workers";

import type { ToolExecution } from "./tool-execution.js";

export class RepositoryToolTask
  extends RpcTarget
  implements RepositoryToolOperation
{
  private pending?: Promise<{ content: string; truncated: boolean }>;
  constructor(
    private readonly execution: ToolExecution,
    private readonly execute: () => Promise<{
      content: string;
      truncated: boolean;
    }>,
  ) {
    super();
  }
  result(): Promise<{ content: string; truncated: boolean }> {
    this.pending ??= Promise.resolve()
      .then(() => {
        this.execution.check();
        return this.execute();
      })
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
