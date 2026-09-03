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

export async function terminateWorkflowIfActive(
  workflow: WorkflowController,
  workflowInstanceId: string,
): Promise<WorkflowTerminationOutcome> {
  const instance = await workflow.get(workflowInstanceId);
  const before = await instance.status();
  if (isTerminal(before.status)) return "already-terminal";

  try {
    await instance.terminate({ rollback: true });
    return "terminated";
  } catch (error) {
    // terminate() rejects if the instance reached a terminal state between the
    // status read and the command. Reconcile that expected race explicitly.
    const after = await instance.status();
    if (isTerminal(after.status)) return "already-terminal";
    throw error;
  }
}
