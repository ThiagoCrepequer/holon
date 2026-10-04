export type WorkflowInstanceState =
  | "complete"
  | "errored"
  | "paused"
  | "queued"
  | "running"
  | "terminated"
  | "unknown"
  | "waiting"
  | "waitingForPause";

export interface WorkflowInstanceController {
  status(): Promise<{ readonly status: WorkflowInstanceState }>;
  terminate(options?: { readonly rollback?: boolean }): Promise<void>;
}

export interface WorkflowController {
  get(id: string): Promise<WorkflowInstanceController>;
}

export type WorkflowTerminationOutcome = "already-terminal" | "terminated";

const terminalStates = new Set<WorkflowInstanceState>([
  "complete",
  "errored",
  "terminated",
]);

function isTerminal(state: WorkflowInstanceState): boolean {
  return terminalStates.has(state);
}

function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    error.name === "WorkflowInstanceNotFoundError" ||
    message.includes("not found") ||
    message.includes("instance not found") ||
    message.includes("not_found")
  );
}

export async function terminateWorkflowIfActive(
  workflow: WorkflowController,
  workflowInstanceId: string,
): Promise<WorkflowTerminationOutcome> {
  try {
    const instance = await workflow.get(workflowInstanceId);
    let before: { readonly status: WorkflowInstanceState };
    try {
      before = await instance.status();
    } catch (error) {
      if (isNotFoundError(error)) return "already-terminal";
      throw error;
    }
    if (isTerminal(before.status)) return "already-terminal";

    try {
      await instance.terminate({ rollback: true });
      return "terminated";
    } catch (error) {
      if (isNotFoundError(error)) return "already-terminal";
      // terminate() rejects if the instance reached a terminal state between the
      // status read and the command. Reconcile that expected race explicitly.
      const after = await instance.status();
      if (isTerminal(after.status)) return "already-terminal";
      throw error;
    }
  } catch (error) {
    if (isNotFoundError(error)) return "already-terminal";
    throw error;
  }
}
