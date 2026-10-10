import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";

import { artifactManifest, assertArtifact } from "./dashboard-artifact.mjs";

// Only compiled output, public configs and schemas. No .dev.vars, logs, state or secret stores.
const directories = [
  "apps/dashboard/build/client",
  "apps/dashboard/build/server",
  "apps/email-delivery/dist",
  "apps/control-plane/dist",
  "apps/repository-executor/dist",
  "packages/db/migrations",
];
const inputs = [
  "pnpm-lock.yaml",
  "apps/dashboard/workers/recovery-mode.ts",
  ...[
    "dashboard",
    "email-delivery",
    "control-plane",
    "repository-executor",
  ].map((name) => `apps/${name}/wrangler.jsonc`),
];
async function collect(root) {
  const files = new Map();
  async function visit(path) {
    for (const entry of await readdir(resolve(root, path), {
      withFileTypes: true,
    })) {
      if (
        entry.name === ".wrangler" ||
        (path.endsWith("/dist") &&
          ["authority", "projection", "test-core"].includes(entry.name))
      )
        continue;
      assert(!entry.isSymbolicLink(), "artifact_symlink");
      const filename = `${path}/${entry.name}`;
      if (entry.isDirectory()) await visit(filename);
      else if (!entry.name.endsWith(".map"))
        files.set(filename, await readFile(resolve(root, filename)));
    }
  }
  for (const path of directories) await visit(path);
  for (const path of inputs)
    files.set(path, await readFile(resolve(root, path)));
  return files;
}
export async function freezeArtifact(root, output, revision, environment) {
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    revision,
    "head_mismatch",
  );
  assert.equal(
    execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    "",
    "source_not_clean",
  );
  const files = await collect(root);
  const built = JSON.parse(
    files.get("apps/dashboard/build/server/wrangler.json"),
  );
  assert.equal(
    built.targetEnvironment ?? "local",
    environment,
    "built_environment_mismatch",
  );
  // CI qualifies freshness by building from its pinned clean checkout immediately before this step.
  // This manifest proves byte identity, not that an arbitrary local output was rebuilt.
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    revision,
    "head_changed_during_freeze",
  );
  assert.equal(
    execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    "",
    "source_changed_during_freeze",
  );
  const manifest = artifactManifest(revision, environment, files);
  // Refuse an existing output; do not overwrite a previously qualified artifact.
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);
  for (const [path, bytes] of files) {
    await mkdir(dirname(resolve(output, path)), { recursive: true });
    await writeFile(resolve(output, path), bytes, { flag: "wx" });
  }
  await writeFile(
    resolve(output, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx" },
  );
  assertArtifact(manifest, await collect(output), { revision, environment });
  return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const [revision, environment, output] = process.argv.slice(2);
  assert(
    revision && environment && output,
    "usage: dashboard-artifact-cli.mjs SHA ENV NEW_OUTPUT_DIRECTORY",
  );
  const manifest = await freezeArtifact(
    process.cwd(),
    resolve(output),
    revision,
    environment,
  );
  console.log(
    JSON.stringify({
      event: "artifact_frozen",
      revision,
      environment,
      files: Object.keys(manifest.entries).length,
    }),
  );
}
