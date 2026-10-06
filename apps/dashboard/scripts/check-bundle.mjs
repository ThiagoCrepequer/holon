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
assert.equal(config.workers_dev, false);
assert.equal(config.preview_urls, false);
assert.equal(config.vars.APP_ORIGIN, "http://127.0.0.1:8794");
assert.equal(config.d1_databases.length, 2);
for (const binding of config.d1_databases) assert.equal(binding.remote, false);
assert.equal(config.services.length, 0);
console.log(
  `Dashboard build: ${assets.length} assets, JS gzip ${compressed} bytes, UI CSS/fonts and server isolation verified.`,
);
