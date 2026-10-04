import { describe, expect, it, vi } from "vitest";

import {
  terminateWorkflowIfActive,
  type WorkflowController,
  type WorkflowInstanceState,
} from "../src/ledger/workflow-superseding.js";

function controller(options: {
  readonly states: readonly WorkflowInstanceState[];
  readonly terminateError?: Error;
}) {
  const statuses = [...options.states];
  const status = vi.fn(() =>
    Promise.resolve({ status: statuses.shift() ?? options.states.at(-1)! }),
  );
  const terminate = vi.fn(() =>
    options.terminateError === undefined
      ? Promise.resolve()
      : Promise.reject(options.terminateError),
  );
  const get = vi.fn(() => Promise.resolve({ status, terminate }));
  return {
    get,
    status,
    terminate,
    value: { get } satisfies WorkflowController,
  };
}

describe("terminateWorkflowIfActive", () => {
  it("terminates an active instance", async () => {
    const workflow = controller({ states: ["running"] });

    await expect(
      terminateWorkflowIfActive(workflow.value, "workflow-active"),
    ).resolves.toBe("terminated");

    expect(workflow.get).toHaveBeenCalledWith("workflow-active");
    expect(workflow.terminate).toHaveBeenCalledWith({ rollback: true });
  });

  it.each(["complete", "errored", "terminated"] as const)(
    "treats %s as an idempotent terminal outcome",
    async (terminalState) => {
      const workflow = controller({ states: [terminalState] });

      await expect(
        terminateWorkflowIfActive(workflow.value, "workflow-terminal"),
      ).resolves.toBe("already-terminal");
      expect(workflow.terminate).not.toHaveBeenCalled();
    },
  );

  it("reconciles a terminal-state race after terminate rejects", async () => {
    const workflow = controller({
      states: ["running", "terminated"],
      terminateError: new Error("already terminal"),
    });

    await expect(
      terminateWorkflowIfActive(workflow.value, "workflow-race"),
    ).resolves.toBe("already-terminal");
  });

  it("preserves a real termination failure for durable retry", async () => {
    const failure = new Error("control plane unavailable");
    const workflow = controller({
      states: ["running", "running"],
      terminateError: failure,
    });

    await expect(
      terminateWorkflowIfActive(workflow.value, "workflow-retry"),
    ).rejects.toBe(failure);
  });

  it("treats instance not found on get as already-terminal", async () => {
    const workflow: WorkflowController = {
      get: () => Promise.reject(new Error("Workflow instance not found")),
    };

    await expect(
      terminateWorkflowIfActive(workflow, "workflow-missing"),
    ).resolves.toBe("already-terminal");
  });

  it("treats instance not found on status as already-terminal", async () => {
    const workflow: WorkflowController = {
      get: () =>
        Promise.resolve({
          status: () => Promise.reject(new Error("instance.not_found")),
          terminate: () => Promise.resolve(),
        }),
    };

    await expect(
      terminateWorkflowIfActive(workflow, "workflow-missing-status"),
    ).resolves.toBe("already-terminal");
  });

  it("treats instance not found on terminate as already-terminal", async () => {
    const workflow = controller({
      states: ["running"],
      terminateError: new Error("instance not found"),
    });

    await expect(
      terminateWorkflowIfActive(workflow.value, "workflow-missing-term"),
    ).resolves.toBe("already-terminal");
  });
});
