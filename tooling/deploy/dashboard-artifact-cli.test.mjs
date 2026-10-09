import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { test } from "node:test";

import { freezeArtifact } from "./dashboard-artifact-cli.mjs";
const script = resolve("tooling/deploy/dashboard-artifact-cli.mjs");
async function fixture() {
  const base = await mkdtemp(resolve(tmpdir(), "holon-artifact-")),
    root = resolve(base, "source");
  await mkdir(root);
  const files = {
    "apps/dashboard/build/server/index.js": "export default {}",
    "apps/dashboard/build/server/wrangler.json": "{}",
    "apps/dashboard/build/client/assets/entry.js": "export default {}",
    "pnpm-lock.yaml": "synthetic lock",
    "apps/dashboard/workers/recovery-mode.ts": "synthetic hold",
  };
  for (const component of [
    "email-delivery",
    "control-plane",
    "repository-executor",
  ])
    files[`apps/${component}/dist/index.js`] = "export default {}";
  for (const component of [
    "dashboard",
    "email-delivery",
    "control-plane",
    "repository-executor",
  ])
    files[`apps/${component}/wrangler.jsonc`] = "{}";
  for (const authority of ["identity", "projection"])
    files[`packages/db/migrations/${authority}/0001.sql`] =
      "CREATE TABLE fixture(id);";
  files["apps/dashboard/build/server/index.js.map"] = "not deployed";
  files["apps/dashboard/build/server/.wrangler/state"] = "not deployed";
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    await writeFile(resolve(root, path), bytes);
  }
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  const commit = () => {
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Synthetic",
        "-c",
        "user.email=synthetic@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "fixture",
      ],
      { cwd: root },
    );
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  };
  return {
    base,
    root,
    revision: commit(),
    commit,
    output: resolve(base, "artifact"),
  };
}
void test("freezes and rechecks actual filesystem bytes, with immutable output and no runtime state/source maps", async () => {
  const f = await fixture();
  try {
    const manifest = await freezeArtifact(
      f.root,
      f.output,
      f.revision,
      "local",
    );
    assert.deepEqual(
      JSON.parse(await readFile(resolve(f.output, "manifest.json"), "utf8")),
      manifest,
    );
    assert(
      !Object.keys(manifest.entries).some(
        (path) => path.includes(".wrangler") || path.endsWith(".map"),
      ),
    );
    await assert.rejects(
      freezeArtifact(f.root, f.output, f.revision, "local"),
      /EEXIST/,
    );
    await assert.rejects(
      freezeArtifact(
        f.root,
        resolve(f.base, "wrong-env"),
        f.revision,
        "preview",
      ),
      /built_environment_mismatch/,
    );
    await assert.rejects(
      freezeArtifact(
        f.root,
        resolve(f.base, "wrong-sha"),
        "a".repeat(40),
        "local",
      ),
      /head_mismatch/,
    );
    await writeFile(resolve(f.root, "pnpm-lock.yaml"), "changed");
    await assert.rejects(
      freezeArtifact(f.root, resolve(f.base, "dirty"), f.revision, "local"),
      /source_not_clean/,
    );
  } finally {
    await rm(f.base, { recursive: true });
  }
});
void test("CLI keeps failures explicit and rejects symlink artifacts before writing", async () => {
  const f = await fixture();
  try {
    const run = spawnSync(
      process.execPath,
      [script, f.revision, "local", f.output],
      { cwd: f.root, encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).event, "artifact_frozen");
    assert.notEqual(
      spawnSync(process.execPath, [script], { cwd: f.root }).status,
      0,
    );
    await symlink(
      "index.js",
      resolve(f.root, "apps/control-plane/dist/linked.js"),
    );
    const revision = f.commit();
    await assert.rejects(
      freezeArtifact(f.root, resolve(f.base, "symlink"), revision, "local"),
      /artifact_symlink/,
    );
  } finally {
    await rm(f.base, { recursive: true });
  }
});
