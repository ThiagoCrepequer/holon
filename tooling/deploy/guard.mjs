import { createHash } from "node:crypto";

export const workers = ["holon-control-plane", "holon-repository-executor"];
const terminal = new Set(["complete", "errored", "terminated"]);
const fingerprint = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class DeploymentGuardError extends Error {
  constructor(code, queuePaused = false) {
    super(code);
    this.name = "DeploymentGuardError";
    this.queuePaused = queuePaused;
  }
}

function requireCondition(condition, code) {
  if (!condition) throw new DeploymentGuardError(code);
}

function workflowSnapshot(rows) {
  requireCondition(Array.isArray(rows), "workflow_inventory_invalid");
  const ids = new Set();
  const snapshot = rows
    .map((row) => {
      requireCondition(
        typeof row.id === "string" && row.id.length > 0 && !ids.has(row.id),
        "workflow_inventory_invalid",
      );
      ids.add(row.id);
      requireCondition(terminal.has(row.status), "workflow_not_terminal");
      return { id: row.id, status: row.status, versionId: row.versionId };
    })
    .toSorted((a, b) => a.id.localeCompare(b.id));
  return fingerprint(snapshot);
}

function containerSnapshot(value, applicationId, namespaceId) {
  requireCondition(
    value.namespaceId === namespaceId && typeof namespaceId === "string",
    "container_namespace_mismatch",
  );
  requireCondition(
    value.applicationId === applicationId,
    "container_identity_mismatch",
  );
  requireCondition(
    typeof value.image === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,511}$/u.test(value.image),
    "container_image_invalid",
  );
  requireCondition(
    Number.isSafeInteger(value.version) && value.version >= 0,
    "container_version_invalid",
  );
  requireCondition(
    Array.isArray(value.instances),
    "container_inventory_invalid",
  );
  requireCondition(
    value.health === null ||
      value.health === undefined ||
      value.health.errorCount === 0,
    "container_health_errors",
  );
  requireCondition(
    !value.health?.summary || value.health.summary === "healthy",
    "container_health_not_ready",
  );
  for (const instance of value.instances) {
    // Historical stopped/inactive instances do not establish readiness and do
    // not have to run the new image. All other non-running states block.
    if (["stopped", "inactive"].includes(instance.state)) continue;
    requireCondition(instance.state === "running", "container_not_ready");
    requireCondition(
      instance.image === value.image,
      "container_image_mismatch",
    );
  }
  // Instance membership can naturally change. Bind approval to the application
  // configuration/rollout, while rechecking every visible instance before resume.
  return {
    applicationId,
    namespaceId,
    image: value.image,
    version: value.version,
    activeRolloutId: value.activeRolloutId ?? null,
  };
}

/**
 * Operational safeguard, not a distributed lock. The operator must exclude other
 * administrators and attest the drain/rollout evidence the public API lacks.
 * Tests inject every external operation; importing this module has no effects.
 */
export async function deployCoordinated(options, ports) {
  requireCondition(
    /^[a-f0-9]{32}$/u.test(options.accountId ?? "") &&
      /^[a-f0-9]{32}$/u.test(options.queueId ?? "") &&
      /^[a-f0-9-]{36}$/u.test(options.applicationId ?? "") &&
      /^[a-f0-9]{40}$/u.test(options.revision ?? "") &&
      /^[A-Za-z0-9-]{8,80}$/u.test(options.sessionId ?? ""),
    "invalid_target",
  );
  const identity = {
    ...options,
    queue: "holon-review-jobs",
    workflow: "holon-review-workflow",
  };
  let pauseAttempted = false;
  const confirm = async (stage, details) => {
    const context = { stage, ...identity, ...details };
    const binding = fingerprint(context);
    const response = await ports.confirm(stage, binding, context);
    requireCondition(
      response?.binding === binding &&
        typeof response.evidence === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,199}$/u.test(response.evidence),
      "confirmation_invalid",
    );
  };
  const assertPaused = async () => {
    requireCondition(
      (await ports.reader.queue()).paused === true,
      "queue_not_paused",
    );
  };
  const assertUnchangedDrain = async (expected) => {
    await assertPaused();
    requireCondition(
      workflowSnapshot(await ports.reader.workflows()) === expected,
      "workflow_snapshot_changed",
    );
  };
  const readDeployment = async (worker) => {
    const result = await ports.reader.deployment(worker);
    requireCondition(
      result.tag === options.revision,
      "deployed_revision_mismatch",
    );
    return { ...result };
  };
  try {
    ports.signal?.throwIfAborted();
    await ports.assertLocalRevision();
    const queue = await ports.reader.queue();
    requireCondition(
      typeof queue.paused === "boolean",
      "queue_preflight_invalid",
    );
    await confirm("pause-delivery", { initiallyPaused: queue.paused });
    ports.signal?.throwIfAborted();
    pauseAttempted = true;
    await ports.command.pause();
    await assertPaused();
    const drain = workflowSnapshot(await ports.reader.workflows());
    await confirm("drain", { workflowSnapshot: drain });
    await assertUnchangedDrain(drain);
    const deployed = {};
    for (const worker of workers) {
      await ports.assertLocalRevision();
      await assertUnchangedDrain(drain);
      ports.signal?.throwIfAborted();
      await ports.command.deploy(worker, options.revision);
      await assertPaused();
      deployed[worker] = await readDeployment(worker);
    }
    const container = containerSnapshot(
      await ports.reader.container(
        options.applicationId,
        deployed[workers[1]].sandboxNamespaceId,
      ),
      options.applicationId,
      deployed[workers[1]].sandboxNamespaceId,
    );
    // This confirmation is required even with zero instances or matching images.
    // The REST application object does not expose authoritative rollout completion.
    await confirm("rollout-and-resume", {
      deployed,
      container,
      workflowSnapshot: drain,
    });
    await ports.assertLocalRevision();
    await assertUnchangedDrain(drain);
    for (const worker of workers) {
      requireCondition(
        fingerprint(await readDeployment(worker)) ===
          fingerprint(deployed[worker]),
        "deployment_changed",
      );
    }
    requireCondition(
      fingerprint(
        containerSnapshot(
          await ports.reader.container(
            options.applicationId,
            deployed[workers[1]].sandboxNamespaceId,
          ),
          options.applicationId,
          deployed[workers[1]].sandboxNamespaceId,
        ),
      ) === fingerprint(container),
      "container_rollout_changed",
    );
    // Last read before mutation narrows, but cannot eliminate, an external admin race.
    await assertUnchangedDrain(drain);
    ports.signal?.throwIfAborted();
    await ports.command.resume();
    ports.signal?.throwIfAborted();
    requireCondition(
      (await ports.reader.queue()).paused === false,
      "resume_unverified",
    );
    ports.signal?.throwIfAborted();
    return { revision: options.revision, deployed, container };
  } catch (error) {
    let queuePaused = false;
    if (pauseAttempted) {
      // A response can be lost after mutation, including resume. Never retry a
      // deployment or resume automatically; make one fail-safe pause attempt.
      try {
        await ports.command.pause();
        queuePaused = (await ports.reader.queue()).paused === true;
      } catch {
        // Report unknown state rather than claiming that pause succeeded.
      }
    }
    throw new DeploymentGuardError(
      error instanceof DeploymentGuardError
        ? error.message
        : "deployment_interrupted",
      queuePaused,
    );
  }
}
