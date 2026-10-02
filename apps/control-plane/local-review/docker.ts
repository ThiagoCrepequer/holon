import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import type { SandboxPort } from "../../repository-executor/src/sandbox-port.js";
import { incidentCase } from "./case.js";

export async function command(
  argv: readonly string[],
  input?: string,
  timeout = 60_000,
  maximum = 8_000_000,
) {
  return await new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    truncated: boolean;
    timedOut: boolean;
  }>((done, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeout);
    child.stdout.on("data", (data: Buffer) => {
      const remaining = maximum - bytes;
      if (data.length > remaining) truncated = true;
      if (remaining > 0) {
        chunks.push(data.subarray(0, remaining));
        bytes += Math.min(data.length, remaining);
      }
    });
    // Do not print repository contents or arbitrary command errors.
    const errors: Buffer[] = [];
    let errorBytes = 0;
    child.stderr.on("data", (data: Buffer) => {
      if (errorBytes < 16_000) {
        errors.push(data.subarray(0, 16_000 - errorBytes));
        errorBytes += data.length;
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({
        stdout: Buffer.concat(chunks).toString("utf8"),
        stderr: Buffer.concat(errors).toString("utf8"),
        exitCode: code ?? 1,
        truncated,
        timedOut,
      });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
export async function localSandbox(root: string): Promise<SandboxPort> {
  const common = await command([
    "git",
    "-C",
    root,
    "rev-parse",
    "--git-common-dir",
  ]);
  if (common.exitCode) throw new Error("Local Git directory unavailable");
  const name = `holon-local-review-${randomUUID()}`;
  const started = await command([
    "docker",
    "run",
    "--detach",
    "--name",
    name,
    "--network=none",
    "--read-only",
    "--cpus=2",
    "--memory=512m",
    "--tmpfs",
    "/workspace:rw,exec,size=128m",
    "--tmpfs",
    "/tmp:rw,size=32m",
    "--mount",
    `type=bind,src=${resolve(root, common.stdout.trim())},dst=/fixture-git,readonly`,
    "--entrypoint",
    "sleep",
    "holon-repository-executor-holonsandbox:worker",
    "1800",
  ]);
  if (started.exitCode !== 0) throw new Error("Local Docker startup failed");
  const run: SandboxPort["run"] = (argv, options) =>
    command(
      [
        "docker",
        "exec",
        "--env",
        "GIT_DIR=/workspace/review.git",
        "--env",
        "GIT_WORK_TREE=/workspace/repository",
        ...(options?.cwd ? ["--workdir", options.cwd] : []),
        name,
        ...argv,
      ],
      undefined,
      options?.timeoutMs,
      options?.maxOutputBytes,
    );
  const sandbox: SandboxPort = {
    configureGitHubEgress: async () => {
      throw new Error("Network is disabled in local replay");
    },
    blockGitHubEgress: async () => {},
    destroy: async () => {
      const result = await command(["docker", "rm", "--force", name]);
      if (result.exitCode) throw new Error("Local container cleanup failed");
    },
    exists: async (path) => (await run(["test", "-f", path])).exitCode === 0,
    readFile: async (path) => {
      const result = await run(["cat", path]);
      if (result.exitCode || result.truncated)
        throw new Error("Local file read failed");
      return result.stdout;
    },
    writeFile: async (path, content) => {
      const result = await command(
        ["docker", "exec", "-i", name, "tee", path],
        content,
      );
      if (result.exitCode) throw new Error("Local file write failed");
    },
    run,
  };
  try {
    await run(["mkdir", "-p", "/workspace/repository"]);
    const initialized = await run(["git", "init"]);
    if (initialized.exitCode)
      throw new Error("Local Git initialization failed");
    await sandbox.writeFile(
      "/workspace/review.git/objects/info/alternates",
      "/fixture-git/objects\n",
    );
    for (const sha of [incidentCase.baseSha, incidentCase.headSha]) {
      if ((await run(["git", "cat-file", "-e", sha + "^{commit}"])).exitCode)
        throw new Error("Fixture Git objects unavailable");
    }
    // SHA is a trusted fixture constant; archive ignores checkout and lifecycle scripts.
    const unpacked = await run([
      "sh",
      "-c",
      `mkdir -p /workspace/repository && git archive ${incidentCase.headSha} | tar -x -C /workspace/repository`,
    ]);
    if (unpacked.exitCode) throw new Error("Fixture Git objects unavailable");
    return sandbox;
  } catch (error) {
    await sandbox.destroy();
    throw error;
  }
}
