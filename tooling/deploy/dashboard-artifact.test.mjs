import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { parse } from "jsonc-parser";

import {
  artifactManifest,
  assertArtifact,
  assertEnvironment,
  assertPromotion,
  promotionGates,
} from "./dashboard-artifact.mjs";
const sha = "a".repeat(40),
  hash = "b".repeat(64);
async function readConfig(path) {
  const errors = [];
  const config = parse(await readFile(path, "utf8"), errors, {
    allowTrailingComma: true,
  });
  assert.equal(errors.length, 0, "invalid_jsonc");
  return config;
}
const productionIds = (
  await readConfig("apps/dashboard/wrangler.jsonc")
).env.production.d1_databases.map((db) => db.database_id);
const files = () =>
  new Map(
    ["dashboard", "email-delivery", "control-plane", "repository-executor"]
      .map((name) => [
        `apps/${name}/dist/index.js`,
        Buffer.from("export default {}"),
      ])
      .concat(
        ["identity", "projection"].map((name) => [
          `packages/db/migrations/${name}/0001.sql`,
          Buffer.from("CREATE TABLE fixture(id);"),
        ]),
      )
      .concat([
        [
          "apps/dashboard/workers/recovery-mode.ts",
          Buffer.from("synthetic hold"),
        ],
      ]),
  );
async function configs(environment = "preview") {
  const result = {};
  for (const name of [
    "dashboard",
    "email-delivery",
    "control-plane",
    "repository-executor",
  ]) {
    const source = await readConfig(`apps/${name}/wrangler.jsonc`);
    result[name] = { ...source, ...source.env?.[environment] };
    delete result[name].env;
    result[name].preview_urls ??= false;
  }
  return result;
}
function configuredFiles(graph, environment = "preview") {
  const input = files();
  for (const [component, config] of Object.entries(graph))
    input.set(
      `apps/${component}/wrangler.jsonc`,
      Buffer.from(JSON.stringify(config)),
    );
  input.set(
    "apps/dashboard/build/server/wrangler.json",
    Buffer.from(
      JSON.stringify({
        ...graph.dashboard,
        targetEnvironment: environment,
      }),
    ),
  );
  return input;
}
void test("an immutable artifact binds all four real components and both schemas to exact revision/environment/bytes", () => {
  const input = files(),
    manifest = artifactManifest(sha, "preview", input);
  assertArtifact(manifest, input, { revision: sha, environment: "preview" });
  for (const expected of [
    { revision: "c".repeat(40), environment: "preview" },
    { revision: sha, environment: "production" },
  ])
    assert.throws(() => assertArtifact(manifest, input, expected), /mismatch/);
  input.set("apps/dashboard/dist/index.js", Buffer.from("changed"));
  assert.throws(
    () =>
      assertArtifact(manifest, input, {
        revision: sha,
        environment: "preview",
      }),
    /artifact_bytes_changed/,
  );
  for (const revision of ["", "not-a-sha"])
    assert.throws(
      () => artifactManifest(revision, "preview", files()),
      /invalid_revision/,
    );
  assert.throws(
    () => artifactManifest(sha, "unknown", files()),
    /invalid_environment/,
  );
  assert.throws(
    () => artifactManifest(sha, "preview", new Map()),
    /missing_files/,
  );
  for (const path of [
    "../escape",
    "/absolute",
    "a/../b",
    "a\\b",
    "a\0b",
    "a//b",
  ])
    assert.throws(
      () =>
        artifactManifest(sha, "preview", new Map([[path, Buffer.from("x")]])),
      /invalid_artifact_entry/,
    );
  for (const name of [
    "dashboard",
    "email-delivery",
    "control-plane",
    "repository-executor",
  ]) {
    const missing = files();
    missing.delete(`apps/${name}/dist/index.js`);
    assert.throws(() => artifactManifest(sha, "preview", missing), /missing_/);
  }
  for (const name of ["identity", "projection"]) {
    const missing = files();
    missing.delete(`packages/db/migrations/${name}/0001.sql`);
    assert.throws(() => artifactManifest(sha, "preview", missing), /missing_/);
  }
  const missing = files();
  missing.delete("apps/dashboard/workers/recovery-mode.ts");
  assert.throws(
    () => artifactManifest(sha, "preview", missing),
    /missing_recovery_hold_source/,
  );
});
void test("preview remains closed, isolated and unable to use a production sender, queue, DB, workflow or binding", async () => {
  const baseline = await configs();
  assertEnvironment(baseline, "preview", productionIds);
  const mutations = [
    (c) => {
      c.dashboard.name = "holon-dashboard";
    },
    (c) => {
      c.dashboard.services[0].service = "holon-control-plane";
    },
    (c) => {
      c["email-delivery"].workers_dev = true;
    },
    (c) => {
      c.dashboard.preview_urls = true;
    },
    (c) => {
      c.dashboard.workers_dev = true;
    },
    (c) => {
      c["email-delivery"].queues.producers[0].queue = "production";
    },
    (c) => {
      c["email-delivery"].queues.consumers[0].dead_letter_queue = "production";
    },
    (c) => {
      c["control-plane"].workflows[0].name = "production";
    },
    (c) => {
      c.dashboard.d1_databases[0].database_name = "production";
    },
    (c) => {
      c.dashboard.d1_databases[0].database_id = productionIds[0];
    },
    (c) => {
      c["control-plane"].durable_objects.bindings[0].script_name =
        "holon-control-plane";
    },
    (c) => {
      c.dashboard.services[0].entrypoint = "EmailDeliveryAuthority";
    },
    (c) => {
      c.dashboard.vars.AUTH_ENVIRONMENT = "production";
    },
    (c) => {
      delete c.dashboard.vars.DASHBOARD_RECOVERY_MODE;
    },
    (c) => {
      c.dashboard.vars.AUTH_REGISTERED_ORIGINS = "{}";
    },
    (c) => {
      c["email-delivery"].vars.APP_ORIGIN = "https://other.invalid";
    },
    (c) => {
      c["email-delivery"].vars.EMAIL_SEND_ENABLED = "true";
    },
    (c) => {
      delete c.dashboard;
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(baseline);
    mutate(changed);
    assert.throws(() => assertEnvironment(changed, "preview", productionIds));
  }
  assert.throws(
    () => assertEnvironment(baseline, "preview"),
    /production_database_inventory_required/,
  );
  assert.throws(
    () => assertEnvironment(baseline, "local"),
    /remote_environment_required/,
  );
  assertEnvironment(await configs("production"), "production");
});
void test("authenticated environments require a valid GitHub App ID for collaboration", async () => {
  const graph = await configs("production");
  graph.dashboard.vars.GITHUB_APP_ID = "123456";
  assertEnvironment(graph, "production");
  for (const value of [
    undefined,
    "",
    "0",
    "-1",
    "1.5",
    "invalid",
    "9007199254740992",
  ]) {
    const changed = structuredClone(graph);
    if (value === undefined) delete changed.dashboard.vars.GITHUB_APP_ID;
    else changed.dashboard.vars.GITHUB_APP_ID = value;
    assert.throws(
      () => assertEnvironment(changed, "production"),
      /github_app_id_required/,
    );
  }
  const preview = await configs("preview");
  assertEnvironment(preview, "preview", productionIds);
});
void test("production qualification requires production access evidence without provisioning preview", async () => {
  const graph = await configs("production");
  graph["repository-executor"].containers[0].image =
    `registry/image@sha256:${hash}`;
  const input = configuredFiles(graph, "production");
  const manifest = artifactManifest(sha, "production", input);
  const now = Date.parse("2026-10-09T00:00:00.000Z");
  const record = {
    status: "passed",
    revision: sha,
    environment: "production",
    digest: hash,
    completedAt: new Date(now).toISOString(),
  };
  const evidence = {
    revision: sha,
    environment: "production",
    rollbackRevision: sha,
    operator: "synthetic-operator",
    authorization: "explicit-human-approval",
    containerImage: `registry/image@sha256:${hash}`,
    installedSchemas: Object.entries(manifest.entries)
      .filter(([path]) => path.startsWith("packages/"))
      .map(([path, value]) => [path, value.sha256]),
    gates: Object.fromEntries(
      promotionGates
        .filter((gate) => gate !== "previewAccess")
        .map((gate) => [gate, structuredClone(record)]),
    ),
  };
  evidence.gates.environmentAccess = structuredClone(record);
  assertPromotion(manifest, manifest, input, evidence, now);
  evidence.gates.environmentAccess.environment = "preview";
  assert.throws(
    () => assertPromotion(manifest, manifest, input, evidence, now),
    /gate_environmentAccess_missing/,
  );
  delete evidence.gates.environmentAccess;
  evidence.gates.previewAccess = structuredClone(record);
  assert.throws(
    () => assertPromotion(manifest, manifest, input, evidence, now),
    /gate_environmentAccess_missing/,
  );
});
void test("promotion requires current evidence, explicit human approval, compatible rollback and provisioned resources", async () => {
  const graph = await configs();
  graph.dashboard.vars.AUTH_ENABLED = "true";
  graph.dashboard.vars.GITHUB_APP_ID = "123456";
  graph.dashboard.vars.DASHBOARD_RECOVERY_MODE = "active";
  graph.dashboard.vars.APP_ORIGIN = "https://preview.example.com";
  graph.dashboard.vars.AUTH_REGISTERED_ORIGINS = JSON.stringify({
    preview: ["https://preview.example.com"],
    production: [],
  });
  graph["email-delivery"].vars.APP_ORIGIN = graph.dashboard.vars.APP_ORIGIN;
  graph.dashboard.d1_databases.forEach((db, i) => {
    db.database_id = `12345678-1234-4000-8000-${String(i).padStart(12, "0")}`;
  });
  graph["repository-executor"].containers[0].image =
    `registry/image@sha256:${hash}`;
  const input = configuredFiles(graph),
    manifest = artifactManifest(sha, "preview", input),
    rollback = structuredClone(manifest);
  const now = Date.parse("2026-10-09T00:00:00.000Z");
  const evidence = {
    revision: sha,
    environment: "preview",
    rollbackRevision: sha,
    operator: "synthetic-operator",
    authorization: "explicit-human-approval",
    containerImage: `registry/image@sha256:${hash}`,
    installedSchemas: Object.entries(manifest.entries)
      .filter(([p]) => p.startsWith("packages/"))
      .map(([p, v]) => [p, v.sha256]),
    gates: Object.fromEntries(
      promotionGates.map((gate) => [
        gate,
        {
          status: "passed",
          revision: sha,
          environment: "preview",
          digest: hash,
          completedAt: new Date(now).toISOString(),
        },
      ]),
    ),
  };
  assertPromotion(manifest, rollback, input, evidence, now, productionIds);
  for (const component of [
    "dashboard",
    "email-delivery",
    "control-plane",
    "repository-executor",
  ]) {
    const missing = new Map(input);
    missing.delete(`apps/${component}/wrangler.jsonc`);
    assert.throws(
      () =>
        assertPromotion(
          artifactManifest(sha, "preview", missing),
          rollback,
          missing,
          evidence,
          now,
          productionIds,
        ),
      /frozen_configuration_missing/,
    );
  }
  for (const [path, replacement, reason] of [
    [
      "apps/dashboard/wrangler.jsonc",
      "{broken",
      /invalid_frozen_configuration/,
    ],
    [
      "apps/dashboard/build/server/wrangler.json",
      null,
      /compiled_configuration_missing/,
    ],
    [
      "apps/dashboard/build/server/wrangler.json",
      JSON.stringify({ ...graph.dashboard, targetEnvironment: "production" }),
      /compiled_environment_mismatch/,
    ],
    [
      "apps/dashboard/build/server/wrangler.json",
      JSON.stringify({
        ...graph.dashboard,
        targetEnvironment: "preview",
        vars: { ...graph.dashboard.vars, DASHBOARD_RECOVERY_MODE: "closed" },
      }),
      /compiled_configuration_mismatch/,
    ],
    [
      "apps/dashboard/build/server/wrangler.json",
      JSON.stringify({
        ...graph.dashboard,
        targetEnvironment: "preview",
        services: [],
      }),
      /compiled_configuration_mismatch/,
    ],
    [
      "apps/dashboard/build/server/wrangler.json",
      JSON.stringify({
        ...graph.dashboard,
        targetEnvironment: "preview",
        d1_databases: [],
      }),
      /compiled_database_mismatch/,
    ],
  ]) {
    const changed = new Map(input);
    if (replacement === null) changed.delete(path);
    else changed.set(path, Buffer.from(replacement));
    assert.throws(
      () =>
        assertPromotion(
          artifactManifest(sha, "preview", changed),
          rollback,
          changed,
          evidence,
          now,
          productionIds,
        ),
      reason,
    );
  }
  const oldGraph = structuredClone(graph);
  oldGraph["repository-executor"].containers[0].image = "./Dockerfile";
  const frozenDockerfile = configuredFiles(oldGraph);
  const staleManifest = artifactManifest(sha, "preview", frozenDockerfile);
  assert.throws(
    () =>
      assertPromotion(
        staleManifest,
        rollback,
        input,
        evidence,
        now,
        productionIds,
      ),
    /artifact_bytes_changed/,
  );
  assert.throws(
    () =>
      assertPromotion(
        staleManifest,
        rollback,
        frozenDockerfile,
        evidence,
        now,
        productionIds,
      ),
    /container_image_not_frozen/,
  );
  for (const mutation of [
    (e) => {
      e.revision = "c".repeat(40);
    },
    (e) => {
      e.environment = "production";
    },
    (e) => {
      delete e.operator;
    },
    (e) => {
      delete e.authorization;
    },
    (e) => {
      e.containerImage = "latest";
    },
    (e) => {
      e.installedSchemas = [];
    },
    (e) => {
      e.rollbackRevision = "wrong";
    },
  ]) {
    const e = structuredClone(evidence);
    mutation(e);
    assert.throws(() =>
      assertPromotion(manifest, rollback, input, e, now, productionIds),
    );
  }
  for (const gate of promotionGates) {
    const e = structuredClone(evidence);
    delete e.gates[gate];
    assert.throws(
      () => assertPromotion(manifest, rollback, input, e, now, productionIds),
      /gate_/,
    );
  }
  for (const date of [
    "invalid",
    new Date(now + 1).toISOString(),
    new Date(now - 86400001).toISOString(),
  ]) {
    const e = structuredClone(evidence);
    e.gates.verify.completedAt = date;
    assert.throws(
      () => assertPromotion(manifest, rollback, input, e, now, productionIds),
      /stale/,
    );
  }
  for (const mutation of [
    (r) => {
      r.environment = "production";
    },
    (r) => {
      r.recoveryHoldSourceDigest = "changed";
    },
    (r) => {
      delete r.entries["packages/db/migrations/identity/0001.sql"];
    },
  ]) {
    const r = structuredClone(rollback);
    mutation(r);
    assert.throws(() =>
      assertPromotion(manifest, r, input, evidence, now, productionIds),
    );
  }
  for (const mutation of [
    (c) => {
      c.dashboard.services[0].service = "foreign-worker";
    },
    (c) => {
      c["repository-executor"].containers[0].image = "./Dockerfile";
    },
    (c) => {
      c.dashboard.vars.AUTH_ENABLED = "false";
    },
    (c) => {
      c.dashboard.vars.DASHBOARD_RECOVERY_MODE = "closed";
    },
    (c) => {
      c.dashboard.d1_databases[0].database_id = "00000000-placeholder";
    },
    (c) => {
      c.dashboard.vars.APP_ORIGIN = "https://preview.example.invalid";
      c.dashboard.vars.AUTH_REGISTERED_ORIGINS = JSON.stringify({
        preview: [c.dashboard.vars.APP_ORIGIN],
      });
      c["email-delivery"].vars.APP_ORIGIN = c.dashboard.vars.APP_ORIGIN;
    },
  ]) {
    const c = structuredClone(graph);
    mutation(c);
    const changed = configuredFiles(c);
    const changedManifest = artifactManifest(sha, "preview", changed);
    assert.throws(() =>
      assertPromotion(
        changedManifest,
        rollback,
        changed,
        evidence,
        now,
        productionIds,
      ),
    );
    assert.throws(
      () =>
        assertPromotion(
          manifest,
          rollback,
          changed,
          evidence,
          now,
          productionIds,
        ),
      /artifact_bytes_changed/,
    );
  }
});
