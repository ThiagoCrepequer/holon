import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";

await test("existing Cloudflare commands deploy noninteractively through Wrangler", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "holon-entrypoints-"));
  try {
    await writeFile(path.join(directory, "package.json"), '{"private":true}');
    await writeFile(
      path.join(directory, "pnpm-workspace.yaml"),
      'packages:\n  - "apps/*"\n',
    );
    await mkdir(path.join(directory, "node_modules/.bin"), { recursive: true });
    const capture = path.join(directory, "wrangler-call.json");
    await writeFile(
      path.join(directory, "node_modules/.bin/wrangler"),
      `#!${process.execPath}\n` +
        'require("node:fs").writeFileSync(process.env.HOLON_TEST_CAPTURE, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), tty: !!process.stdin.isTTY }));\n' +
        'process.exitCode = Number(process.env.HOLON_TEST_EXIT || "0");\n',
      { mode: 0o755 },
    );
    for (const name of ["control-plane", "repository-executor"]) {
      const manifest = JSON.parse(
        await readFile(
          new URL(`../../apps/${name}/package.json`, import.meta.url),
          "utf8",
        ),
      );
      assert.equal(manifest.scripts.deploy, "wrangler deploy");
      assert.equal(
        manifest.scripts.build,
        "wrangler deploy --dry-run --outdir dist",
      );
      await mkdir(path.join(directory, "apps", name), { recursive: true });
      await writeFile(
        path.join(directory, "apps", name, "package.json"),
        JSON.stringify({ name: manifest.name, scripts: manifest.scripts }),
      );
    }
    const cases = [
      { name: "control-plane", script: "deploy", expected: ["deploy"] },
      { name: "repository-executor", script: "deploy", expected: ["deploy"] },
      {
        name: "repository-executor",
        script: "deploy:bootstrap",
        expected: ["deploy", "--config", "wrangler.bootstrap.jsonc"],
      },
    ];
    for (const { name, script, expected } of cases) {
      for (const exitCode of [0, 23]) {
        await rm(capture, { force: true });
        const result = spawnSync(
          "pnpm",
          ["--filter", `@holon/${name}`, "run", script],
          {
            cwd: directory,
            encoding: "utf8",
            timeout: 20_000,
            env: {
              ...process.env,
              CI: "true",
              pnpm_config_verify_deps_before_run: "false",
              HOLON_TEST_CAPTURE: capture,
              HOLON_TEST_EXIT: String(exitCode),
            },
          },
        );
        assert.equal(result.error, undefined);
        assert.equal(result.signal, null);
        if (exitCode === 0) {
          assert.equal(result.status, 0, result.stderr || result.stdout);
        } else {
          // pnpm/Corepack may normalize a child status to 1. The contract is
          // failure propagation, not preservation of the exact numeric code.
          assert.notEqual(result.status, 0);
          assert.match(
            result.stderr + result.stdout,
            /exit (?:code|status) 23/i,
          );
        }
        const call = JSON.parse(await readFile(capture, "utf8"));
        assert.deepEqual(call.args, expected);
        assert.equal(
          call.cwd,
          await realpath(path.join(directory, "apps", name)),
        );
        assert.equal(call.tty, false);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test("root guard is explicitly opt-in rather than the automatic deploy entrypoint", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.scripts.deploy, undefined);
  assert.equal(
    manifest.scripts["deploy:guarded"],
    "node tooling/deploy/cli.mjs",
  );
});
