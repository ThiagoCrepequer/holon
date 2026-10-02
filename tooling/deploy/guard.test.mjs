import assert from "node:assert/strict";
import { test } from "node:test";

import { deployCoordinated, DeploymentGuardError } from "./guard.mjs";

const revision = "a".repeat(40);
function fixture() {
  const calls = [];
  let paused = false;
  const versions = {
    "holon-control-plane": {
      deploymentId: "cp-deploy",
      versionId: "cp-version",
      tag: revision,
    },
    "holon-repository-executor": {
      deploymentId: "ex-deploy",
      versionId: "ex-version",
      sandboxNamespaceId: "f".repeat(32),
      tag: revision,
    },
  };
  const options = {
    accountId: "b".repeat(32),
    queueId: "c".repeat(32),
    applicationId: "11111111-1111-4111-8111-111111111111",
    revision,
    sessionId: "session-test",
  };
  const ports = {
    reader: {
      queue: async () => ({ paused }),
      workflows: async () => [
        { id: "old-run", status: "complete", versionId: "old-version" },
      ],
      deployment: async (worker) => versions[worker],
      container: async () => ({
        applicationId: options.applicationId,
        namespaceId: "f".repeat(32),
        image: "registry.cloudflare.com/app@sha256:" + "d".repeat(64),
        version: 3,
        activeRolloutId: "rollout-3",
        health: { errorCount: 0 },
        instances: [],
      }),
    },
    command: {
      pause: async () => {
        calls.push("pause");
        paused = true;
      },
      resume: async () => {
        calls.push("resume");
        paused = false;
      },
      deploy: async (worker) => {
        calls.push(worker);
      },
    },
    assertLocalRevision: async () => {
      calls.push("local");
    },
    confirm: async (stage, binding) => {
      calls.push(stage);
      return { binding, evidence: "change-123" };
    },
  };
  return { options, ports, calls, versions, paused: () => paused };
}

await test("coordinates both deployments and resumes only after bound rollout confirmation", async () => {
  const f = fixture();
  const result = await deployCoordinated(f.options, f.ports);
  assert.equal(result.revision, revision);
  assert.equal(f.paused(), false);
  assert.deepEqual(
    f.calls.filter((c) => c !== "local"),
    [
      "pause-delivery",
      "pause",
      "drain",
      "holon-control-plane",
      "holon-repository-executor",
      "rollout-and-resume",
      "resume",
    ],
  );
});

for (const status of [
  "queued",
  "running",
  "waiting",
  "paused",
  "waitingForPause",
  "rollingBack",
  "unknown",
  "retrying",
]) {
  await test(`blocks ${status} workflows and leaves queue paused`, async () => {
    const f = fixture();
    f.ports.reader.workflows = async () => [
      { id: "active", status, versionId: "v" },
    ];
    await assert.rejects(
      deployCoordinated(f.options, f.ports),
      /workflow_not_terminal/,
    );
    assert.equal(f.paused(), true);
    assert.ok(!f.calls.includes("holon-control-plane"));
  });
}

await test("rejects stale/unbound operator evidence", async () => {
  const f = fixture();
  f.ports.confirm = async (stage, binding) => ({
    binding: stage === "drain" ? "old-session" : binding,
    evidence: "change-123",
  });
  await assert.rejects(
    deployCoordinated(f.options, f.ports),
    /confirmation_invalid/,
  );
  assert.equal(f.paused(), true);
  assert.ok(!f.calls.includes("holon-control-plane"));
});

await test("new admission after manual drain invalidates the snapshot", async () => {
  const f = fixture();
  let scans = 0;
  f.ports.reader.workflows = async () =>
    scans++ === 0 ? [] : [{ id: "late", status: "complete", versionId: "v" }];
  await assert.rejects(
    deployCoordinated(f.options, f.ports),
    /workflow_snapshot_changed/,
  );
  assert.equal(f.paused(), true);
  assert.ok(!f.calls.includes("holon-control-plane"));
});

await test("failed executor deployment never resumes after control-plane success", async () => {
  const f = fixture();
  f.ports.command.deploy = async (worker) => {
    f.calls.push(worker);
    if (worker === "holon-repository-executor") throw new Error("test failure");
  };
  await assert.rejects(
    deployCoordinated(f.options, f.ports),
    DeploymentGuardError,
  );
  assert.equal(f.paused(), true);
  assert.ok(!f.calls.includes("resume"));
});

await test("wrong deployed revision blocks the next deployment", async () => {
  const f = fixture();
  f.versions["holon-control-plane"].tag = "e".repeat(40);
  await assert.rejects(
    deployCoordinated(f.options, f.ports),
    /deployed_revision_mismatch/,
  );
  assert.ok(!f.calls.includes("holon-repository-executor"));
  assert.equal(f.paused(), true);
});

await test("empty container list still requires explicit rollout evidence", async () => {
  const f = fixture();
  f.ports.confirm = async (stage, binding) =>
    stage === "rollout-and-resume"
      ? undefined
      : { binding, evidence: "change-123" };
  await assert.rejects(
    deployCoordinated(f.options, f.ports),
    /confirmation_invalid/,
  );
  assert.ok(!f.calls.includes("resume"));
  assert.equal(f.paused(), true);
});

await test("concurrent deployment during confirmation blocks resume", async () => {
  const f = fixture();
  f.ports.confirm = async (stage, binding) => {
    if (stage === "rollout-and-resume")
      f.versions["holon-control-plane"] = {
        ...f.versions["holon-control-plane"],
        versionId: "other",
      };
    return { binding, evidence: "change-123" };
  };
  await assert.rejects(
    deployCoordinated(f.options, f.ports),
    /deployment_changed/,
  );
  assert.ok(!f.calls.includes("resume"));
  assert.equal(f.paused(), true);
});

await test("uncertain resume is followed by a verified fail-safe pause", async () => {
  const f = fixture();
  const resume = f.ports.command.resume;
  f.ports.command.resume = async () => {
    await resume();
    throw new Error("lost response");
  };
  await assert.rejects(
    deployCoordinated(f.options, f.ports),
    (e) => e instanceof DeploymentGuardError && e.queuePaused,
  );
  assert.equal(f.paused(), true);
  assert.equal(f.calls.at(-1), "pause");
});

await test("pause verification failure never claims paused", async () => {
  const f = fixture();
  f.ports.reader.queue = async () => ({ paused: false });
  await assert.rejects(
    deployCoordinated(f.options, f.ports),
    (e) => e instanceof DeploymentGuardError && !e.queuePaused,
  );
  assert.ok(!f.calls.includes("holon-control-plane"));
});

await test("invalid target fails before any remote operation", async () => {
  const f = fixture();
  await assert.rejects(
    deployCoordinated({ ...f.options, revision: "main" }, f.ports),
    /invalid_target/,
  );
  assert.deepEqual(f.calls, []);
});

await test("interrupt during final evidence reads never resumes", async () => {
  const f = fixture();
  const controller = new AbortController();
  f.ports.signal = controller.signal;
  const confirm = f.ports.confirm;
  f.ports.confirm = async (stage, binding) => {
    const answer = await confirm(stage, binding);
    if (stage === "rollout-and-resume") {
      f.ports.reader.queue = async () => {
        controller.abort();
        return { paused: true };
      };
    }
    return answer;
  };
  await assert.rejects(
    deployCoordinated(f.options, f.ports),
    DeploymentGuardError,
  );
  assert.ok(!f.calls.includes("resume"));
  assert.equal(f.paused(), true);
});

for (const state of [
  "provisioning",
  "stopping",
  "failed",
  "unhealthy",
  "unknown",
]) {
  await test(`blocks Container state ${state}`, async () => {
    const f = fixture();
    const container = f.ports.reader.container;
    f.ports.reader.container = async () => ({
      ...(await container()),
      instances: [{ id: "instance", state, image: "old" }],
    });
    await assert.rejects(
      deployCoordinated(f.options, f.ports),
      /container_not_ready/,
    );
    assert.ok(!f.calls.includes("resume"));
  });
}
for (const summary of ["degraded", "unhealthy", "pending"]) {
  await test(`blocks explicit unhealthy summary ${summary} even without error details`, async () => {
    const f = fixture();
    const container = f.ports.reader.container;
    f.ports.reader.container = async () => ({
      ...(await container()),
      health: { summary, errorCount: 0 },
    });
    await assert.rejects(
      deployCoordinated(f.options, f.ports),
      /container_health_not_ready/,
    );
  });
}
await test("running image mismatch blocks but stopped history does not establish readiness", async () => {
  const f = fixture();
  const container = f.ports.reader.container;
  f.ports.reader.container = async () => ({
    ...(await container()),
    instances: [
      { id: "historical", state: "stopped", image: null },
      { id: "current", state: "running", image: "wrong" },
    ],
  });
  await assert.rejects(
    deployCoordinated(f.options, f.ports),
    /container_image_mismatch/,
  );
});
await test("signal while resume is in flight returns to paused instead of reporting success", async () => {
  const f = fixture();
  const controller = new AbortController();
  f.ports.signal = controller.signal;
  const resume = f.ports.command.resume;
  f.ports.command.resume = async () => {
    await resume();
    controller.abort();
  };
  await assert.rejects(
    deployCoordinated(f.options, f.ports),
    (e) => e.queuePaused,
  );
  assert.equal(f.paused(), true);
});
await test("failed safety pause reports unconfirmed state", async () => {
  const f = fixture();
  let attempts = 0;
  const pause = f.ports.command.pause;
  f.ports.command.pause = async () => {
    if (attempts++ > 0) throw new Error("unavailable");
    await pause();
  };
  f.ports.reader.workflows = async () => {
    throw new Error("unavailable");
  };
  await assert.rejects(
    deployCoordinated(f.options, f.ports),
    (e) => !e.queuePaused,
  );
});

await test("wrong/inaccessible queue ID fails before pausing any named queue", async () => {
  const f = fixture();
  f.ports.reader.queue = async () => {
    throw new Error("wrong target");
  };
  await assert.rejects(
    deployCoordinated(f.options, f.ports),
    DeploymentGuardError,
  );
  assert.ok(!f.calls.includes("pause"));
});
