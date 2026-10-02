import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  parseArguments,
  deploymentCommand,
  confirmationPhrase,
  commandEnvironment,
  queueCommand,
} from "./cli.mjs";

const argv = [
  "--account",
  "a".repeat(32),
  "--queue",
  "b".repeat(32),
  "--application",
  "11111111-1111-4111-8111-111111111111",
  "--revision",
  "c".repeat(40),
];
test("requires explicit immutable targets and rejects extra switches", () => {
  assert.equal(parseArguments(argv).revision, "c".repeat(40));
  assert.throws(() => parseArguments([...argv, "--yes"]));
  assert.throws(() => parseArguments(argv.slice(0, -2)));
  assert.throws(() => parseArguments([...argv, "--queue", "d".repeat(32)]));
});
test("deployment command pins worker and full revision without a shell", () => {
  assert.deepEqual(deploymentCommand("holon-control-plane", "c".repeat(40)), [
    "exec",
    "wrangler",
    "deploy",
    "--config",
    "apps/control-plane/wrangler.jsonc",
    "--env",
    "",
    "--tag",
    "c".repeat(40),
    "--message",
    "Holon coordinated deployment " + "c".repeat(40),
  ]);
  assert.throws(() => deploymentCommand("other-worker", "c".repeat(40)));
});
test("rollout confirmation requires both deployed revisions and image", () => {
  const phrase = confirmationPhrase("rollout-and-resume", "binding", {
    deployed: {
      "holon-control-plane": { versionId: "cp" },
      "holon-repository-executor": { versionId: "ex" },
    },
    container: { image: "image:sha" },
  });
  assert.equal(phrase, "RETOMAR cp ex image:sha binding");
});
test("noninteractive execution cannot pause or deploy", () => {
  const result = spawnSync(
    process.execPath,
    ["tooling/deploy/cli.mjs", ...argv],
    {
      encoding: "utf8",
      env: { ...process.env, CLOUDFLARE_API_TOKEN: "test-not-a-secret" },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /terminal interativo/);
});
test("independent package deploy entrypoints are blocked, dry-run build preserved", async () => {
  for (const name of ["control-plane", "repository-executor"]) {
    const manifest = JSON.parse(
      await readFile(
        new URL(`../../apps/${name}/package.json`, import.meta.url),
        "utf8",
      ),
    );
    assert.equal(
      manifest.scripts.deploy,
      "node ../../tooling/deploy/blocked.mjs",
    );
    assert.equal(
      manifest.scripts.build,
      "wrangler deploy --dry-run --outdir dist",
    );
  }
});
test("blocked entrypoint exits without spawning deployment", () => {
  const result = spawnSync(process.execPath, ["tooling/deploy/blocked.mjs"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /pnpm run deploy/);
});

test("real CLI main is simulated end to end without commands or network", async () => {
  const {
    mkdtemp,
    rm,
    readdir,
    readFile: read,
  } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  for (const scenario of [
    "success",
    "active-workflow",
    "reject-drain",
    "wrong-tag",
    "fail-executor",
    "interrupt-final",
    "audit-failed",
    "missing-token",
    "dirty-tree",
    "wrong-toolchain",
    "verify-failed",
    "lock-existing",
  ]) {
    const directory = await mkdtemp(join(tmpdir(), "holon-deploy-sim-"));
    try {
      const child = spawnSync(
        process.execPath,
        ["tooling/deploy/test/cli-simulation.mjs", scenario, directory],
        { encoding: "utf8" },
      );
      assert.equal(child.status, 0, child.stderr);
      const line = child.stdout
        .split("\n")
        .find((value) => value.startsWith("SIMULATION_RESULT "));
      assert.ok(line, child.stderr);
      const result = JSON.parse(line.slice("SIMULATION_RESULT ".length));
      assert.equal(result.failed, scenario !== "success", scenario);
      const mutated = result.calls.some((call) =>
        call.includes("pause-delivery"),
      );
      if (scenario === "success") {
        assert.equal(result.paused, false);
        assert.equal(result.confirmations, 3);
        const [auditName] = await readdir(
          join(directory, "holon-deploy-audit"),
        );
        const audit = await read(
          join(directory, "holon-deploy-audit", auditName),
          "utf8",
        );
        assert.match(audit, /"stage":"completed"/);
        assert.ok(!audit.includes("offline-simulation-token"));
      } else if (mutated) assert.equal(result.paused, true, scenario);
      if (
        [
          "missing-token",
          "dirty-tree",
          "wrong-toolchain",
          "verify-failed",
          "lock-existing",
        ].includes(scenario)
      )
        assert.equal(mutated, false, scenario);
      if (
        [
          "active-workflow",
          "reject-drain",
          "wrong-tag",
          "fail-executor",
          "interrupt-final",
        ].includes(scenario)
      )
        assert.ok(
          !result.calls.some((call) => call.includes("resume-delivery")),
          scenario,
        );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("pins Wrangler target, origin and sanitized logs despite ambient overrides", () => {
  const env = commandEnvironment(
    {
      CLOUDFLARE_ENV: "staging",
      CLOUDFLARE_API_BASE_URL: "https://wrong.example",
      WRANGLER_LOG_SANITIZE: "false",
      CLOUDFLARE_API_TOKEN: "existing",
    },
    "a".repeat(32),
  );
  assert.equal(env.CLOUDFLARE_ENV, "");
  assert.equal(
    env.CLOUDFLARE_API_BASE_URL,
    "https://api.cloudflare.com/client/v4",
  );
  assert.equal(env.WRANGLER_LOG_SANITIZE, "true");
  assert.equal(env.CLOUDFLARE_API_TOKEN, "existing");
  for (const command of [
    queueCommand("pause-delivery"),
    queueCommand("resume-delivery"),
    deploymentCommand("holon-control-plane", "a".repeat(40)),
  ])
    assert.equal(command[command.indexOf("--env") + 1], "");
  assert.throws(() => queueCommand("purge"));
});
