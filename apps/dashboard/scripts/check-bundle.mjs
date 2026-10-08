import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
async function files(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const filename = `${directory}/${item.name}`;
    if (item.isDirectory()) result.push(...(await files(filename)));
    else result.push(filename);
  }
  return result;
}
const assets = await files("build/client");
let compressed = 0;
for (const file of assets.filter((value) => value.endsWith(".js"))) {
  const content = await readFile(file, "utf8");
  compressed += gzipSync(content).length;
  for (const forbidden of [
    "cloudflare:workers",
    "better-auth",
    "drizzle-orm",
    "APP_ORIGIN",
    "readCommand",
    "configuredOrigin",
  ])
    assert(
      !content.includes(forbidden),
      `${file}: server-only symbol ${forbidden}`,
    );
}
// Base document only. Review/diff/chart budgets will be qualified by their owning features.
// Record the measured baseline before selecting a regression budget.
const css = (
  await Promise.all(
    assets
      .filter((value) => value.endsWith(".css"))
      .map((file) => readFile(file, "utf8")),
  )
).join("\n");
for (const token of [
  "--holon-action-bg",
  "--holon-motion-slow",
  ".inline-flex",
  ".holon-button",
  ".holon-dialog",
])
  assert(css.includes(token), `Missing UI CSS: ${token}`);
assert(
  assets.some((file) => file.endsWith(".woff")),
  "Local fonts missing from build",
);
const config = JSON.parse(await readFile("build/server/wrangler.json", "utf8"));
const expectedEnv = process.env.CLOUDFLARE_ENV;
const targetEnv = config.targetEnvironment;

if (expectedEnv === "production") {
  assert.equal(
    targetEnv,
    "production",
    "CLOUDFLARE_ENV=production mismatch with built targetEnvironment",
  );
  assert.equal(config.name, "holon-dashboard");
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.equal(
    config.vars.APP_ORIGIN,
    "https://holon-dashboard.thiago-crepequer.workers.dev",
  );
  assert.equal(config.vars.AUTH_ENVIRONMENT, "production");
  assert.equal(
    config.vars.AUTH_ENABLED,
    "true",
    `Production build requires AUTH_ENABLED === "true", received: ${config.vars.AUTH_ENABLED}`,
  );
  const origins = JSON.parse(config.vars.AUTH_REGISTERED_ORIGINS);
  assert(
    Array.isArray(origins.preview),
    "AUTH_REGISTERED_ORIGINS.preview must be an array",
  );
  assert(
    Array.isArray(origins.production),
    "AUTH_REGISTERED_ORIGINS.production must be an array",
  );
  assert(
    origins.production.includes(
      "https://holon-dashboard.thiago-crepequer.workers.dev",
    ),
    "Production registered origins must contain APP_ORIGIN",
  );
  assert.equal(config.d1_databases.length, 2);
  const identity = config.d1_databases.find((b) => b.binding === "IDENTITY_DB");
  assert(identity, "Missing IDENTITY_DB binding");
  assert.equal(identity.database_name, "holon-identity");
  assert.equal(identity.database_id, "52a95f05-168f-4702-a064-10934931d3c8");
  assert.notEqual(
    identity.remote,
    false,
    "Production IDENTITY_DB must not set remote: false",
  );

  const projection = config.d1_databases.find(
    (b) => b.binding === "PROJECTION_DB",
  );
  assert(projection, "Missing PROJECTION_DB binding");
  assert.equal(projection.database_name, "holon-projection");
  assert.equal(projection.database_id, "af121530-2f99-4d01-8155-c20efc040a3b");
  assert.notEqual(
    projection.remote,
    false,
    "Production PROJECTION_DB must not set remote: false",
  );

  assert.equal(config.observability?.enabled, true);
  assert.equal(config.observability?.logs?.invocation_logs, false);
} else {
  assert.notEqual(
    targetEnv,
    "production",
    "Local build produced production targetEnvironment",
  );
  assert.equal(config.name, "holon-dashboard-local");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.vars.APP_ORIGIN, "http://127.0.0.1:8794");
  assert.equal(config.d1_databases.length, 2);
  for (const binding of config.d1_databases)
    assert.equal(binding.remote, false);
}
assert.equal(config.services.length, 0);
console.log(
  `Dashboard build (${targetEnv ?? "local"}): ${assets.length} assets, JS gzip ${compressed} bytes, UI CSS/fonts and server isolation verified.`,
);
