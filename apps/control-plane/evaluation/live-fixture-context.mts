import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import type { SandboxPort } from "../../repository-executor/src/sandbox-port.js";
import { collectStructuralRepositoryInventory } from "../../repository-executor/src/structural-repository-inventory.js";

const execute = promisify(execFile);
const unavailable = async (): Promise<never> => {
  throw new Error("Read-only fixture boundary");
};

/** Materialize only versioned synthetic constants, with hooks/templates/global config disabled. */
export async function commitFixture(directory: string): Promise<string> {
  const options = {
    cwd: directory,
    timeout: 5_000,
    maxBuffer: 2_000,
    env: {
      PATH: process.env.PATH,
      PROJECT_IDENTIFICATION_MODE: process.env.PROJECT_IDENTIFICATION_MODE,
      PROJECT_IDENTIFICATION_PROFILE:
        process.env.PROJECT_IDENTIFICATION_PROFILE,
      AGENT_TRACE_PAYLOADS: process.env.AGENT_TRACE_PAYLOADS,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Synthetic benchmark",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Synthetic benchmark",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
    },
  };
  await execute(
    "git",
    ["init", "--quiet", "--template=", "--initial-branch=fixture"],
    options,
  );
  await execute("git", ["add", "--", "src"], options);
  await execute(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgSign=false",
      "commit",
      "--quiet",
      "-m",
      "Synthetic fixture",
    ],
    options,
  );
  const { stdout } = await execute("git", ["rev-parse", "HEAD"], options);
  const sha = stdout.trim();
  if (!/^[a-f0-9]{40}$/u.test(sha)) throw new Error("Invalid synthetic commit");
  return sha;
}

/** Run the production inventory policy against the immutable, network-isolated image. */
export async function prepareFixtureInventory(
  directory: string,
  files: Readonly<Record<string, string>>,
  patch: string,
  imageDigest: string,
) {
  const started = performance.now();
  const events: Array<{
    operation: string;
    durationMs: number;
    bytes: number;
  }> = [];
  const port: SandboxPort = {
    configureGitHubEgress: unavailable,
    blockGitHubEgress: unavailable,
    destroy: unavailable,
    exists: unavailable,
    writeFile: unavailable,
    async readFile(path) {
      const relative = path.replace(/^\/workspace\/repository\//u, "");
      if (!(relative in files)) throw new Error("Unknown fixture path");
      const start = performance.now();
      const content = await readFile(`${directory}/${relative}`, "utf8");
      events.push({
        operation: "read_file",
        durationMs: performance.now() - start,
        bytes: Buffer.byteLength(content),
      });
      return content;
    },
    async run(argv, options) {
      if (
        !(
          argv[0] === "git" &&
          argv[1] === "--literal-pathspecs" &&
          argv[2] === "ls-tree"
        ) &&
        !(argv[0] === "rg" && argv[1] === "--files-with-matches")
      )
        throw new Error("Invalid inventory command");
      const start = performance.now();
      const command =
        argv[0] === "git"
          ? [
              "git",
              "-c",
              "safe.directory=/workspace/repository",
              ...argv.slice(1),
            ]
          : [...argv];
      try {
        const { stdout, stderr } = await execute(
          "docker",
          [
            "run",
            "--rm",
            "--network",
            "none",
            "--read-only",
            "--entrypoint",
            "/usr/bin/env",
            "--mount",
            `type=bind,src=${directory},dst=/workspace/repository,readonly`,
            "--workdir",
            "/workspace/repository",
            imageDigest,
            ...command,
          ],
          {
            timeout: options?.timeoutMs ?? 10_000,
            maxBuffer: options?.maxOutputBytes ?? 100_000,
          },
        );
        events.push({
          operation: argv[0],
          durationMs: performance.now() - start,
          bytes: Buffer.byteLength(stdout),
        });
        return { exitCode: 0, stdout, stderr, truncated: false };
      } catch (error) {
        if (
          argv[0] === "rg" &&
          error instanceof Error &&
          "code" in error &&
          error.code === 1
        )
          return { exitCode: 1, stdout: "", stderr: "", truncated: false };
        throw new Error("Fixture inventory failed", { cause: error });
      }
    },
  };
  const inventory = await collectStructuralRepositoryInventory(port, patch);
  return {
    inventory,
    metrics: { durationMs: performance.now() - started, events },
  };
}
