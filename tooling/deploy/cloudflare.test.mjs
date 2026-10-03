import assert from "node:assert/strict";
import test from "node:test";

import { createCloudflareReader } from "./cloudflare.mjs";

const accountId = "a".repeat(32);
const queueId = "b".repeat(32);
const namespaceId = "f".repeat(32);
const applicationId = "182bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e";
const versionId = "282bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e";
const deploymentId = "382bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e";
const workflowId = "482bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e";
const token = "test-only-token-never-log";
const image = `registry.cloudflare.com/${accountId}/holon@sha256:${"c".repeat(64)}`;
const timestamp = "2026-10-02T12:00:00.000Z";
const envelope = (result, resultInfo) => ({
  success: true,
  errors: [],
  messages: [],
  result,
  ...(resultInfo === undefined ? {} : { result_info: resultInfo }),
});
const queue = (paused = true) =>
  envelope({
    queue_id: queueId,
    queue_name: "holon-review-jobs",
    settings: { delivery_paused: paused },
  });
const instance = (id = "review-a", status = "complete") => ({
  id,
  status,
  version_id: versionId,
  workflow_id: workflowId,
  created_on: timestamp,
  modified_on: timestamp,
  started_on: timestamp,
  ended_on: status === "complete" ? timestamp : null,
});
const workflowPage = (rows, cursor) =>
  envelope(rows, {
    count: rows.length,
    per_page: 100,
    ...(cursor === undefined ? {} : { cursor }),
  });
const deployments = () =>
  envelope({
    deployments: [
      {
        id: deploymentId,
        created_on: timestamp,
        strategy: "percentage",
        versions: [{ version_id: versionId, percentage: 100 }],
      },
    ],
  });
const sandboxBinding = () => ({
  name: "SANDBOXES",
  type: "durable_object_namespace",
  class_name: "HolonSandbox",
  namespace_id: namespaceId,
});
const workerVersion = () =>
  envelope({
    id: versionId,
    annotations: { "workers/tag": "a".repeat(40) },
    bindings: [sandboxBinding()],
  });
const application = () =>
  envelope({
    id: applicationId,
    account_id: accountId,
    name: "holon-repository-executor",
    scheduling_policy: "default",
    durable_objects: { namespace_id: namespaceId },
    configuration: { image },
    version: 7,
    active_rollout_id: "rollout-7",
    health: {
      summary: "healthy",
      instances: { active: 1, assigned: 0 },
      errors: [],
    },
  });
const containerInstance = (id = "d".repeat(64), state = "running") => ({
  id,
  application_id: applicationId,
  image,
  status: { state, updated_at: timestamp },
});
const containerPage = (rows, next) =>
  envelope(rows, {
    per_page: 100,
    ...(next === undefined ? {} : { next_page_token: next }),
  });

function fixture(...responses) {
  const calls = [];
  const reader = createCloudflareReader({
    accountId,
    queueId,
    token,
    fetchImpl: async (url, init) => {
      calls.push({ url: new URL(url), init });
      assert.ok(responses.length, "unexpected request");
      const value = responses.shift();
      if (typeof value === "function") return value(url, init);
      return new Response(JSON.stringify(value), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  return { reader, calls };
}

async function rejectsQueue(value, pattern = /Cloudflare/) {
  await assert.rejects(fixture(value).reader.queue(), pattern);
}

await test("reads only the fixed official queue endpoint and explicit boolean", async () => {
  for (const paused of [true, false]) {
    const { reader, calls } = fixture(queue(paused));
    assert.deepEqual(await reader.queue(), { paused });
    assert.equal(
      calls[0].url.href,
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${queueId}`,
    );
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.redirect, "error");
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${token}`);
    assert.ok(calls[0].init.signal instanceof AbortSignal);
    assert.equal(calls[0].init.body, undefined);
  }
});

await test("rejects queue identity/name mismatches and missing or coerced pause", async () => {
  for (const mutate of [
    (x) => {
      x.result.queue_id = "c".repeat(32);
    },
    (x) => {
      x.result.queue_name = "another-queue";
    },
    (x) => {
      delete x.result.settings;
    },
    (x) => {
      delete x.result.settings.delivery_paused;
    },
    (x) => {
      x.result.settings.delivery_paused = "true";
    },
  ]) {
    const value = queue();
    mutate(value);
    await rejectsQueue(value);
  }
});

await test("rejects unsuccessful and malformed API envelopes", async () => {
  for (const value of [
    null,
    [],
    {},
    { result: queue().result },
    { ...queue(), success: false },
    { ...queue(), errors: [{ message: token }] },
    { ...queue(), errors: {} },
    { ...queue(), messages: {} },
    { ...queue(), result: [] },
  ]) {
    await rejectsQueue(value);
  }
});

await test("sanitizes HTTP, network, redirect and JSON errors", async () => {
  for (const response of [
    () => new Response(token, { status: 403 }),
    () =>
      new Response(token, {
        status: 302,
        headers: { location: "https://example.com" },
      }),
    () => {
      throw new Error(token);
    },
    () => new Response(token),
    () =>
      new Response(JSON.stringify(queue()), {
        headers: { "content-type": "text/html" },
      }),
    () => {
      const r = new Response(JSON.stringify(queue()));
      Object.defineProperty(r, "redirected", { value: true });
      return r;
    },
  ]) {
    await assert.rejects(fixture(response).reader.queue(), (error) => {
      assert.match(error.message, /Cloudflare/);
      assert.ok(!String(error.stack).includes(token));
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

const oversized = () =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
        controller.close();
      },
    }),
    { headers: { "content-type": "application/json" } },
  );

await test("bounds streamed response bytes even without content-length", async () => {
  await rejectsQueue(oversized);
  await rejectsQueue(
    () =>
      new Response("{}", {
        headers: {
          "content-type": "application/json",
          "content-length": "999999999",
        },
      }),
  );
});

await test("rejects invalid configuration before any fetch", () => {
  for (const args of [
    { accountId: "https://evil.test" },
    { queueId: "../queues" },
    { token: "" },
    { token: "bad\r\nheader" },
    { fetchImpl: null },
  ]) {
    assert.throws(
      () => createCloudflareReader({ accountId, queueId, token, ...args }),
      /Cloudflare/,
    );
  }
});

await test("exhausts Workflow cursor pages without status filters and sorts identities", async () => {
  const { reader, calls } = fixture(
    workflowPage([instance("z", "running")], "next/+="),
    workflowPage([instance("a", "terminated")]),
  );
  assert.deepEqual(await reader.workflows(), [
    { id: "a", status: "terminated", versionId },
    { id: "z", status: "running", versionId },
  ]);
  assert.equal(calls[0].url.searchParams.get("per_page"), "100");
  assert.equal(calls[0].url.searchParams.get("status"), null);
  assert.equal(calls[1].url.searchParams.get("cursor"), "next/+=");
  assert.equal(calls[1].url.searchParams.get("page"), null);
});

await test("accepts every documented Workflow state but rejects unknown states", async () => {
  const statuses = [
    "queued",
    "running",
    "paused",
    "errored",
    "terminated",
    "complete",
    "waitingForPause",
    "waiting",
    "rollingBack",
  ];
  const rows = statuses.map((state, index) => instance(`id-${index}`, state));
  assert.equal(
    (await fixture(workflowPage(rows)).reader.workflows()).length,
    statuses.length,
  );
  await assert.rejects(
    fixture(workflowPage([instance("x", "retrying")])).reader.workflows(),
    /Cloudflare/,
  );
});

await test("Workflow scan rejects loops, duplicates and inconsistent workflow identities", async () => {
  const different = instance("b");
  different.workflow_id = applicationId;
  for (const pages of [
    [
      workflowPage([instance("a")], "loop"),
      workflowPage([instance("b")], "loop"),
    ],
    [workflowPage([instance("a")], "next"), workflowPage([instance("a")])],
    [workflowPage([instance("a"), different])],
  ])
    await assert.rejects(fixture(...pages).reader.workflows(), /Cloudflare/);
});

await test("Workflow scan rejects missing and ambiguous pagination or identity", async () => {
  const full = Array.from({ length: 100 }, (_, i) => instance(`i-${i}`));
  for (const response of [
    envelope([]),
    envelope([], { count: 1, per_page: 100 }),
    envelope([], { count: 0, per_page: 100, cursor: 7 }),
    envelope([], { count: 0, per_page: 100, next_cursor: "unknown-shape" }),
    workflowPage(full),
    workflowPage([], "next"),
    envelope([], { count: 0, per_page: 100, page: 1, total_pages: 2 }),
    workflowPage([{ ...instance(), version_id: "short-id" }]),
    workflowPage([{ ...instance(), workflow_id: undefined }]),
  ])
    await assert.rejects(fixture(response).reader.workflows(), /Cloudflare/);
});

await test("bounds Workflow page count without network access", async () => {
  let calls = 0;
  const reader = createCloudflareReader({
    accountId,
    queueId,
    token,
    fetchImpl: async () => {
      calls++;
      return new Response(
        JSON.stringify(
          workflowPage([instance(`i-${calls}`)], `cursor-${calls}`),
        ),
        { headers: { "content-type": "application/json" } },
      );
    },
  });
  await assert.rejects(reader.workflows(), /Cloudflare/);
  assert.ok(calls <= 100);
});

await test("reads active deployment then exact version tag using documented beta endpoint", async () => {
  const value = deployments();
  value.result.deployments.push({
    ...value.result.deployments[0],
    id: applicationId,
  });
  const { reader, calls } = fixture(value, workerVersion());
  assert.deepEqual(await reader.deployment("holon-control-plane"), {
    deploymentId,
    versionId,
    tag: "a".repeat(40),
  });
  assert.equal(
    calls[0].url.pathname,
    `/client/v4/accounts/${accountId}/workers/scripts/holon-control-plane/deployments`,
  );
  assert.equal(
    calls[1].url.pathname,
    `/client/v4/accounts/${accountId}/workers/workers/holon-control-plane/versions/${versionId}`,
  );
});

await test("rejects deployment guesses, splits, unknown strategies, missing tag and mismatched version", async () => {
  for (const mutate of [
    (x) => {
      x.result.deployments = [];
    },
    (x) => {
      x.result.deployments[0].versions[0].percentage = 99;
    },
    (x) => {
      x.result.deployments[0].versions.push({
        version_id: applicationId,
        percentage: 0,
      });
    },
    (x) => {
      x.result.deployments[0].strategy = "other";
    },
    (x) => {
      x.result.deployments[0].id = "short-id";
    },
    (x) => {
      x.result.deployments[0].versions[0].version_id = "short-id";
    },
  ]) {
    const value = deployments();
    mutate(value);
    await assert.rejects(
      fixture(value).reader.deployment("holon-control-plane"),
      /Cloudflare/,
    );
  }
  for (const result of [
    { id: versionId },
    { id: applicationId, annotations: { "workers/tag": "sha" } },
  ]) {
    await assert.rejects(
      fixture(deployments(), envelope(result)).reader.deployment(
        "holon-repository-executor",
      ),
      /Cloudflare/,
    );
  }
  const { reader, calls } = fixture();
  await assert.rejects(reader.deployment("other-worker"), /Cloudflare/);
  assert.equal(calls.length, 0);
});

await test("returns sanitized Container evidence across every instance page", async () => {
  const first = containerInstance("f".repeat(64));
  const second = containerInstance("e".repeat(64), "stopped");
  const { reader, calls } = fixture(
    application(),
    containerPage([first], "next/+="),
    containerPage([second]),
  );
  assert.deepEqual(await reader.container(applicationId, namespaceId), {
    applicationId,
    namespaceId,
    image,
    version: 7,
    activeRolloutId: "rollout-7",
    health: { summary: "healthy", active: 1, assigned: 0, errorCount: 0 },
    instances: [
      { id: second.id, image, state: "stopped" },
      { id: first.id, image, state: "running" },
    ],
  });
  assert.ok(calls[1].url.pathname.endsWith("/instances-v2"));
  assert.equal(calls[1].url.searchParams.get("state"), null);
  assert.equal(calls[2].url.searchParams.get("page_token"), "next/+=");
});

await test("empty instances and absent rollout id do not assert readiness", async () => {
  const app = application();
  delete app.result.active_rollout_id;
  const result = await fixture(app, containerPage([])).reader.container(
    applicationId,
    namespaceId,
  );
  assert.equal(result.activeRolloutId, null);
  assert.deepEqual(result.instances, []);
  assert.equal(result.complete, undefined);
  assert.equal(result.ready, undefined);
});

await test("fails closed for unsupported Container policy, identity and health", async () => {
  for (const mutate of [
    (x) => {
      x.result.scheduling_policy = "durable_object";
    },
    (x) => {
      x.result.id = deploymentId;
    },
    (x) => {
      x.result.account_id = queueId;
    },
    (x) => {
      x.result.configuration = {};
    },
    (x) => {
      x.result.version = "7";
    },
    (x) => {
      x.result.health.summary = "unknown";
    },
    (x) => {
      x.result.health.instances.active = -1;
    },
    (x) => {
      x.result.active_rollout_id = 7;
    },
  ]) {
    const app = application();
    mutate(app);
    await assert.rejects(
      fixture(app).reader.container(applicationId, namespaceId),
      /Cloudflare/,
    );
  }
});

await test("Container instances reject malformed state, ownership and pagination", async () => {
  for (const page of [
    envelope([]),
    containerPage([{ ...containerInstance(), application_id: deploymentId }]),
    containerPage([{ ...containerInstance(), id: "short" }]),
    containerPage([containerInstance(undefined, "surprise")]),
    containerPage([{ ...containerInstance(), image: null }]),
    envelope([], { next_page_token: 4 }),
    envelope([], { next_cursor: "unsupported" }),
    envelope([], { page_token: "not-requested" }),
  ])
    await assert.rejects(
      fixture(application(), page).reader.container(applicationId, namespaceId),
      /Cloudflare/,
    );
  await assert.rejects(
    fixture(
      application(),
      containerPage([containerInstance()], "loop"),
      containerPage([containerInstance("e".repeat(64))], "loop"),
    ).reader.container(applicationId, namespaceId),
    /Cloudflare/,
  );
});

await test("preserves unavailable Container health and optional sampled summary", async () => {
  const missing = application();
  delete missing.result.health;
  assert.equal(
    (
      await fixture(missing, containerPage([])).reader.container(
        applicationId,
        namespaceId,
      )
    ).health,
    null,
  );
  const noSummary = application();
  delete noSummary.result.health.summary;
  assert.deepEqual(
    (
      await fixture(noSummary, containerPage([])).reader.container(
        applicationId,
        namespaceId,
      )
    ).health,
    { summary: null, active: 1, assigned: 0, errorCount: 0 },
  );
});

await test("bounds an unresponsive fetch and aborts without exposing its error", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  const reader = createCloudflareReader({
    accountId,
    queueId,
    token,
    fetchImpl: (_url, init) => {
      signal = init.signal;
      return new Promise(() => {});
    },
  });
  const pending = reader.queue();
  t.mock.timers.tick(15_000);
  await assert.rejects(
    pending,
    /Cloudflare: leitura falhou ou resposta inválida/,
  );
  assert.equal(signal.aborted, true);
});

await test("sanitizes JSON parser errors and rejects a silently changed response URL", async () => {
  await rejectsQueue(
    () =>
      new Response(`{ invalid: "${token}" }`, {
        headers: { "content-type": "application/json" },
      }),
  );
  await rejectsQueue(() => {
    const response = new Response(JSON.stringify(queue()), {
      headers: { "content-type": "application/json" },
    });
    Object.defineProperty(response, "url", {
      value: "https://example.com/response",
    });
    return response;
  });
});

await test("validates all Container states and counts errors without retaining details", async () => {
  const app = application();
  app.result.health.errors = [{ event: { message: token } }];
  const states = [
    "provisioning",
    "running",
    "failed",
    "stopping",
    "stopped",
    "unhealthy",
    "inactive",
    "unknown",
  ];
  const rows = states.map((state, i) =>
    containerInstance(String(i).repeat(64), state),
  );
  const result = await fixture(app, containerPage(rows)).reader.container(
    applicationId,
    namespaceId,
  );
  assert.equal(result.health.errorCount, 1);
  assert.ok(!JSON.stringify(result).includes(token));
  assert.deepEqual(
    result.instances.map((row) => row.state),
    states,
  );
});

await test("bounds Container pages and rejects duplicate instance identities", async () => {
  await assert.rejects(
    fixture(
      application(),
      containerPage([containerInstance()], "next"),
      containerPage([containerInstance()]),
    ).reader.container(applicationId, namespaceId),
    /Cloudflare/,
  );
  let pages = 0;
  const reader = createCloudflareReader({
    accountId,
    queueId,
    token,
    fetchImpl: async (url) => {
      let data;
      if (new URL(url).pathname.endsWith("/instances-v2")) {
        pages++;
        data = containerPage(
          [containerInstance(pages.toString(16).padStart(64, "0"))],
          `next-${pages}`,
        );
      } else data = application();
      return new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  await assert.rejects(
    reader.container(applicationId, namespaceId),
    /Cloudflare/,
  );
  assert.ok(pages <= 100);
});

await test("allows an explicit empty/null Workflow cursor to terminate a full page", async () => {
  const rows = Array.from({ length: 100 }, (_, i) => instance(`i-${i}`));
  for (const end of ["", null]) {
    assert.equal(
      (await fixture(workflowPage(rows, end)).reader.workflows()).length,
      100,
    );
  }
});

await test("preserves unavailable images only for stopped and inactive Container history", async () => {
  for (const state of ["stopped", "inactive"]) {
    for (const unavailable of [undefined, null, ""]) {
      const row = {
        ...containerInstance(undefined, state),
        image: unavailable,
      };
      const result = await fixture(
        application(),
        containerPage([row]),
      ).reader.container(applicationId, namespaceId);
      assert.equal(result.instances[0].image, null);
    }
  }
  const running = { ...containerInstance(), image: undefined };
  await assert.rejects(
    fixture(application(), containerPage([running])).reader.container(
      applicationId,
      namespaceId,
    ),
    /Cloudflare/,
  );
});

await test("allows omitted envelope diagnostics and unused timestamp metadata", async () => {
  const queueValue = { success: true, result: queue().result };
  assert.deepEqual(await fixture(queueValue).reader.queue(), { paused: true });
  const row = instance();
  for (const key of ["created_on", "modified_on", "started_on", "ended_on"])
    delete row[key];
  assert.deepEqual(await fixture(workflowPage([row])).reader.workflows(), [
    { id: row.id, status: row.status, versionId },
  ]);
  const version = deployments();
  delete version.result.deployments[0].created_on;
  assert.equal(
    (
      await fixture(version, workerVersion()).reader.deployment(
        "holon-control-plane",
      )
    ).versionId,
    versionId,
  );
  const containerRow = containerInstance();
  delete containerRow.status.updated_at;
  assert.equal(
    (
      await fixture(
        application(),
        containerPage([containerRow]),
      ).reader.container(applicationId, namespaceId)
    ).instances.length,
    1,
  );
});

await test("binds the exact deployed executor version to its self-bound sandbox namespace", async () => {
  for (const scriptName of [undefined, "holon-repository-executor"]) {
    const detail = workerVersion();
    detail.result.bindings[0].script_name = scriptName;
    const { reader, calls } = fixture(deployments(), detail);
    assert.deepEqual(await reader.deployment("holon-repository-executor"), {
      deploymentId,
      versionId,
      tag: "a".repeat(40),
      sandboxNamespaceId: namespaceId,
    });
    assert.equal(calls.length, 2);
    assert.equal(
      calls[1].url.pathname,
      `/client/v4/accounts/${accountId}/workers/workers/holon-repository-executor/versions/${versionId}`,
    );
  }
});

await test("rejects missing, malformed, ambiguous or externally bound executor sandboxes", async () => {
  for (const bindings of [
    undefined,
    null,
    {},
    [],
    [null],
    [{ name: "OTHER", type: "plain_text" }],
    [sandboxBinding(), sandboxBinding()],
    [
      sandboxBinding(),
      { name: "SANDBOXES", type: "plain_text", text: "other" },
    ],
    [{ ...sandboxBinding(), class_name: "UnrelatedSandbox" }],
    [{ ...sandboxBinding(), type: "kv_namespace" }],
    [{ ...sandboxBinding(), namespace_id: undefined }],
    [{ ...sandboxBinding(), namespace_id: "bad-id" }],
    [{ ...sandboxBinding(), script_name: "another-worker" }],
    [{ ...sandboxBinding(), environment: "staging" }],
    [{ ...sandboxBinding(), dispatch_namespace: "another-namespace" }],
  ]) {
    const detail = workerVersion();
    detail.result.bindings = bindings;
    await assert.rejects(
      fixture(deployments(), detail).reader.deployment(
        "holon-repository-executor",
      ),
      /Cloudflare/,
    );
  }
});

await test("rejects an unrelated Container application even with matching image and health", async () => {
  for (const binding of [
    undefined,
    null,
    {},
    { namespace_id: queueId },
    { namespace_id: "bad-id" },
  ]) {
    const app = application();
    app.result.durable_objects = binding;
    await assert.rejects(
      fixture(app, containerPage([])).reader.container(
        applicationId,
        namespaceId,
      ),
      /Cloudflare/,
    );
  }
  const { reader, calls } = fixture();
  for (const expected of [undefined, null, "", "bad-id"]) {
    await assert.rejects(
      reader.container(applicationId, expected),
      /Cloudflare/,
    );
  }
  assert.equal(calls.length, 0);
});
