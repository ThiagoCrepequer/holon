import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { parse } from "jsonc-parser";

const schemas = (artifact) =>
  Object.entries(artifact.entries)
    .filter(([path]) => path.startsWith("packages/db/migrations/"))
    .map(([path, value]) => [path, value.sha256]);

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const promotionGates = [
  "verify",
  "bilingual",
  "physicalBrowsers",
  "remoteD1",
  "oauthPrivate",
  "emailProvider",
  "recovery",
  "previewAccess",
  "rollback",
];
const components = [
  "dashboard",
  "email-delivery",
  "control-plane",
  "repository-executor",
];
const databases = (config) =>
  config.d1_databases.map(({ binding, database_name, database_id }) => ({
    binding,
    database_name,
    database_id,
  }));
function pathAllowed(path) {
  return (
    typeof path === "string" &&
    path.length <= 1024 &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path.startsWith("/") &&
    path.split("/").every((part) => part && part !== "." && part !== "..")
  );
}
export function artifactManifest(revision, environment, files) {
  assert(/^[a-f0-9]{40}$/.test(revision), "invalid_revision");
  assert(
    ["local", "preview", "production"].includes(environment),
    "invalid_environment",
  );
  assert(files instanceof Map && files.size > 0, "missing_files");
  const entries = {};
  for (const [path, bytes] of [...files].toSorted(([a], [b]) =>
    a.localeCompare(b),
  )) {
    assert(
      pathAllowed(path) && Buffer.isBuffer(bytes),
      "invalid_artifact_entry",
    );
    entries[path] = { sha256: digest(bytes), bytes: bytes.length };
  }
  for (const component of components)
    assert(
      Object.keys(entries).some(
        (path) => path.startsWith(`apps/${component}/`) && path.endsWith(".js"),
      ),
      `missing_${component}_bundle`,
    );
  for (const authority of ["identity", "projection"])
    assert(
      Object.keys(entries).some(
        (path) =>
          path.startsWith(`packages/db/migrations/${authority}/`) &&
          path.endsWith(".sql"),
      ),
      `missing_${authority}_schema`,
    );
  assert(
    entries["apps/dashboard/workers/recovery-mode.ts"],
    "missing_recovery_hold_source",
  );
  return {
    revision,
    environment,
    entries,
    recoveryHoldSourceDigest:
      entries["apps/dashboard/workers/recovery-mode.ts"].sha256,
  };
}
export function assertArtifact(manifest, files, expected) {
  assert.equal(manifest.revision, expected.revision, "revision_mismatch");
  assert.equal(
    manifest.environment,
    expected.environment,
    "environment_mismatch",
  );
  assert.deepEqual(
    manifest,
    artifactManifest(expected.revision, expected.environment, files),
    "artifact_bytes_changed",
  );
}
/** Checks the declared graph, without contacting or provisioning Cloudflare. */
export function assertEnvironment(
  configs,
  environment,
  productionDatabaseIds = [],
) {
  assert(
    ["preview", "production"].includes(environment),
    "remote_environment_required",
  );
  const suffix = environment === "preview" ? "-preview" : "";
  const edges = {
    dashboard: [
      {
        binding: "REVIEW_CORE",
        service: `holon-control-plane${suffix}`,
        entrypoint: "DashboardReviewReader",
      },
      { binding: "EMAIL_DELIVERY", service: `holon-email-delivery${suffix}` },
    ],
    "email-delivery": [
      {
        binding: "EMAIL_AUTHORITY",
        service: `holon-dashboard${suffix}`,
        entrypoint: "EmailDeliveryAuthority",
      },
    ],
    "control-plane": [
      {
        binding: "REVIEW_PROJECTION",
        service: `holon-dashboard${suffix}`,
        entrypoint: "ReviewProjectionWriter",
      },
      {
        binding: "DASHBOARD_ACCESS_EVENTS",
        service: `holon-dashboard${suffix}`,
        entrypoint: "GitHubAccessEvents",
      },
      {
        binding: "REPOSITORY_EXECUTOR",
        service: `holon-repository-executor${suffix}`,
      },
    ],
    "repository-executor": [
      {
        binding: "GITHUB_CREDENTIAL_BROKER",
        service: `holon-control-plane${suffix}`,
        entrypoint: "GitHubCredentialBrokerEntrypoint",
      },
    ],
  };
  if (environment === "preview")
    assert(
      productionDatabaseIds.length === 2 &&
        productionDatabaseIds.every(
          (id) => typeof id === "string" && id.length === 36,
        ),
      "production_database_inventory_required",
    );
  assert.equal(
    Object.keys(configs).length,
    components.length,
    "incomplete_graph",
  );
  for (const component of components) {
    const config = configs[component];
    assert.equal(
      config.name,
      `holon-${component}${suffix}`,
      "worker_environment_mismatch",
    );
    assert.equal(config.preview_urls, false, "public_preview_url");
    assert.deepEqual(
      config.services,
      edges[component],
      "cross_environment_binding",
    );
    for (const binding of config.durable_objects?.bindings ?? [])
      assert(
        !binding.script_name || binding.script_name === config.name,
        "cross_environment_durable_object",
      );
    if (environment === "preview") {
      assert.equal(config.workers_dev, false, "public_preview_worker");
      for (const queue of [
        ...(config.queues?.producers ?? []),
        ...(config.queues?.consumers ?? []),
      ]) {
        assert(queue.queue.endsWith("-preview"), "production_queue_in_preview");
        if (queue.dead_letter_queue)
          assert(
            queue.dead_letter_queue.endsWith("-preview"),
            "production_dlq_in_preview",
          );
      }
      for (const workflow of config.workflows ?? [])
        assert(
          workflow.name.endsWith("-preview"),
          "production_workflow_in_preview",
        );
      for (const db of config.d1_databases ?? []) {
        assert(
          db.database_name.endsWith("-preview"),
          "production_database_in_preview",
        );
        assert(
          !productionDatabaseIds.includes(db.database_id),
          "production_database_id_in_preview",
        );
      }
    }
  }
  const dashboard = configs.dashboard,
    email = configs["email-delivery"];
  assert.equal(
    dashboard.vars.AUTH_ENVIRONMENT,
    environment,
    "auth_environment_mismatch",
  );
  assert(
    ["active", "closed", "rebuilding"].includes(
      dashboard.vars.DASHBOARD_RECOVERY_MODE,
    ),
    "recovery_hold_missing",
  );
  const origins = JSON.parse(dashboard.vars.AUTH_REGISTERED_ORIGINS);
  assert.deepEqual(
    origins[environment],
    [dashboard.vars.APP_ORIGIN],
    "unregistered_origin",
  );
  assert.equal(
    email.vars.APP_ORIGIN,
    dashboard.vars.APP_ORIGIN,
    "email_origin_mismatch",
  );
  assert.equal(email.workers_dev, false, "public_sender");
  assert.equal(email.preview_urls, false, "public_sender_preview");
  if (environment === "preview")
    assert.equal(
      email.vars.EMAIL_SEND_ENABLED,
      "false",
      "preview_effect_enabled",
    );
}
/** Evidence is an operator record, never generated authorization or proof of a real smoke. */
export function assertPromotion(
  manifest,
  rollback,
  files,
  evidence,
  now = Date.now(),
  productionDatabaseIds = [],
) {
  assertArtifact(manifest, files, {
    revision: manifest.revision,
    environment: manifest.environment,
  });
  const configs = {};
  for (const component of components) {
    const bytes = files.get(`apps/${component}/wrangler.jsonc`);
    assert(bytes, "frozen_configuration_missing");
    const errors = [];
    const source = parse(bytes.toString("utf8"), errors, {
      allowTrailingComma: true,
    });
    assert.equal(errors.length, 0, "invalid_frozen_configuration");
    configs[component] = { ...source, ...source.env?.[manifest.environment] };
    delete configs[component].env;
  }
  const compiledBytes = files.get("apps/dashboard/build/server/wrangler.json");
  assert(compiledBytes, "compiled_configuration_missing");
  const compiled = JSON.parse(compiledBytes);
  assert.equal(
    compiled.targetEnvironment,
    manifest.environment,
    "compiled_environment_mismatch",
  );
  for (const key of [
    "name",
    "services",
    "vars",
    "workers_dev",
    "preview_urls",
    "triggers",
  ])
    assert.deepEqual(
      compiled[key],
      configs.dashboard[key],
      "compiled_configuration_mismatch",
    );
  // The Vite adapter relocates migration paths; binding identities must remain exact.
  assert.deepEqual(
    databases(compiled),
    databases(configs.dashboard),
    "compiled_database_mismatch",
  );
  assertEnvironment(configs, manifest.environment, productionDatabaseIds);
  assert.equal(
    evidence.revision,
    manifest.revision,
    "evidence_revision_mismatch",
  );
  assert.equal(
    evidence.environment,
    manifest.environment,
    "evidence_environment_mismatch",
  );
  assert(
    /^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(evidence.operator ?? ""),
    "operator_required",
  );
  assert.equal(
    evidence.authorization,
    "explicit-human-approval",
    "authorization_required",
  );
  assert.equal(
    rollback.environment,
    manifest.environment,
    "rollback_environment_mismatch",
  );
  assert.equal(
    rollback.recoveryHoldSourceDigest,
    manifest.recoveryHoldSourceDigest,
    "rollback_cannot_hold_recovery",
  );
  assert.equal(
    evidence.rollbackRevision,
    rollback.revision,
    "rollback_revision_unqualified",
  );
  assert.deepEqual(
    schemas(rollback),
    schemas(manifest),
    "rollback_schema_incompatible",
  );
  assert.deepEqual(
    evidence.installedSchemas,
    schemas(manifest),
    "installed_schema_mismatch",
  );
  for (const gate of promotionGates) {
    const record = evidence.gates?.[gate];
    assert(
      record?.status === "passed" &&
        record.revision === manifest.revision &&
        record.environment === manifest.environment &&
        /^[a-f0-9]{64}$/.test(record.digest ?? ""),
      `gate_${gate}_missing`,
    );
    const date = Date.parse(record.completedAt);
    assert(
      Number.isFinite(date) && date <= now && now - date <= 86400000,
      `gate_${gate}_stale`,
    );
  }
  assert(
    /^.+@sha256:[a-f0-9]{64}$/.test(evidence.containerImage ?? ""),
    "container_digest_required",
  );
  assert.equal(
    configs["repository-executor"].containers[0].image,
    evidence.containerImage,
    "container_image_not_frozen",
  );
  const dashboard = configs.dashboard;
  assert.equal(
    dashboard.vars.DASHBOARD_RECOVERY_MODE,
    "active",
    "recovery_not_reconciled",
  );
  assert.equal(dashboard.vars.AUTH_ENABLED, "true", "auth_not_ready");
  assert(
    !dashboard.vars.APP_ORIGIN.endsWith(".invalid"),
    "origin_not_provisioned",
  );
  for (const db of dashboard.d1_databases)
    assert(!db.database_id.startsWith("00000000-"), "database_not_provisioned");
}
