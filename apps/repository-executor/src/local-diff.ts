import { gitShaSchema, type ExecutorRequest } from "@holon/contracts";

import { RepositoryPreparationError } from "./sandbox-errors.js";
import type { SandboxPort } from "./sandbox-port.js";

const maximumDiffBytes = 16_000_000;
const pageBytes = 48_000;
const diffPath = "/workspace/holon-pr.diff";
const historyCompletenessScript = String.raw`
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const shallowPath = execFileSync('git', ['rev-parse', '--git-path', 'shallow'], { encoding: 'utf8' }).trim();
if (!fs.existsSync(shallowPath)) {
  process.stdout.write('complete');
} else {
  const shallow = new Set(fs.readFileSync(shallowPath, 'utf8').trim().split('\n'));
  const [base, head, ancestor] = process.argv.slice(1);
  const commits = execFileSync('git', ['rev-list', base, head, '^' + ancestor], {
    encoding: 'utf8', maxBuffer: 2000000,
  }).trim().split('\n');
  process.stdout.write(commits.some(sha => shallow.has(sha)) ? 'incomplete' : 'complete');
}`;

/** Trusted host program. No shell, repository scripts, external diff or textconv. */
export const diffGenerationScript = String.raw`
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const [base, head, path] = process.argv.slice(1);
if (!/^[a-f0-9]{40}$/.test(base) || !/^[a-f0-9]{40}$/.test(head)) process.exit(2);
const child = spawn('git', [
  'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--find-renames',
  '--src-prefix=a/', '--dst-prefix=b/', base, head, '--',
], { stdio: ['ignore', 'pipe', 'ignore'] });
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 60000);
const completion = new Promise(resolve => {
  child.on('error', () => resolve(-1));
  child.on('close', resolve);
});
(async () => {
  let bytes = 0;
  const hash = createHash('sha256');
  const fd = fs.openSync(path, 'w', 0o600);
  try {
    for await (const chunk of child.stdout) {
      bytes += chunk.length;
      if (bytes > 16000000) throw new Error('limit');
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.length) offset += fs.writeSync(fd, chunk, offset, chunk.length - offset);
    }
    if (await completion !== 0) throw new Error('git');
    process.stdout.write(JSON.stringify({ bytes, digest: hash.digest('hex') }));
  } catch {
    child.kill('SIGKILL');
    fs.rmSync(path, { force: true });
    process.exitCode = bytes > 16000000 ? 3 : timedOut ? 4 : 1;
  } finally {
    fs.closeSync(fd);
    clearTimeout(timer);
  }
})();`;

const readDiffPageScript = String.raw`
const fs = require('node:fs');
const [path, rawOffset] = process.argv.slice(1);
const offset = Number(rawOffset);
if (!Number.isSafeInteger(offset) || offset < 0) process.exit(2);
const fd = fs.openSync(path, 'r');
const buffer = Buffer.alloc(48000);
try {
  const n = fs.readSync(fd, buffer, 0, buffer.length, offset);
  process.stdout.write(buffer.subarray(0, n).toString('base64'));
} finally { fs.closeSync(fd); }`;

function commandTimeout(
  deadline: number,
  maximum: number,
  stage: "merge-base" | "diff",
) {
  const remaining = deadline - Date.now();
  if (remaining <= 0)
    throw new RepositoryPreparationError(true, stage, "timed-out");
  return Math.min(remaining, maximum);
}

export async function resolveMergeBase(
  sandbox: Pick<SandboxPort, "run">,
  request: Pick<ExecutorRequest, "baseSha" | "headSha" | "pullRequestNumber">,
  url: string,
  cwd: string,
  deadline = Date.now() + 240_000,
): Promise<string> {
  // Fetch only through the existing repository-scoped credential broker.
  // Exact SHAs remain authoritative if the PR ref moves during preparation.
  for (const depth of [64, 256, 1024, 4096]) {
    const fetched = await sandbox.run(
      [
        "git",
        "fetch",
        "--no-tags",
        `--depth=${depth}`,
        url,
        request.baseSha,
        request.headSha,
        `+refs/pull/${request.pullRequestNumber}/head:refs/holon/head`,
      ],
      {
        cwd,
        timeoutMs: commandTimeout(deadline, 60_000, "merge-base"),
        maxOutputBytes: 20_000,
      },
    );
    if (fetched.exitCode !== 0 || fetched.timedOut || fetched.truncated)
      throw new RepositoryPreparationError(true, "fetch", "command-failed");
    const result = await sandbox.run(
      ["git", "merge-base", "--all", request.baseSha, request.headSha],
      {
        cwd,
        timeoutMs: commandTimeout(deadline, 10_000, "merge-base"),
        maxOutputBytes: 1_000,
      },
    );
    if (result.timedOut || result.truncated)
      throw new RepositoryPreparationError(false, "merge-base", "unavailable");
    if (result.exitCode === 0) {
      const candidates = result.stdout.trim().split(/\s+/u);
      if (candidates.length !== 1)
        throw new RepositoryPreparationError(
          false,
          "merge-base",
          "unavailable",
        );
      const ancestor = gitShaSchema.parse(candidates[0]);
      const history = await sandbox.run(
        [
          "node",
          "-e",
          historyCompletenessScript,
          request.baseSha,
          request.headSha,
          ancestor,
        ],
        {
          cwd,
          timeoutMs: commandTimeout(deadline, 10_000, "merge-base"),
          maxOutputBytes: 100,
        },
      );
      if (history.exitCode !== 0 || history.truncated || history.timedOut)
        throw new RepositoryPreparationError(
          false,
          "merge-base",
          "unavailable",
        );
      if (history.stdout === "complete") return ancestor;
      if (history.stdout !== "incomplete")
        throw new RepositoryPreparationError(
          false,
          "merge-base",
          "unavailable",
        );
    }
    if (result.exitCode !== 0 && result.exitCode !== 1)
      throw new RepositoryPreparationError(
        false,
        "merge-base",
        "command-failed",
      );
  }
  throw new RepositoryPreparationError(
    false,
    "merge-base",
    "history-incomplete",
  );
}

export async function readLocalDiff(
  sandbox: Pick<SandboxPort, "run">,
  base: string,
  head: string,
  cwd: string,
  deadline = Date.now() + 240_000,
): Promise<string> {
  const result = await sandbox.run(
    ["node", "-e", diffGenerationScript, base, head, diffPath],
    {
      cwd,
      timeoutMs: commandTimeout(deadline, 70_000, "diff"),
      maxOutputBytes: 1_000,
    },
  );
  if (result.exitCode === 3)
    throw new RepositoryPreparationError(false, "diff", "size-limit");
  if (result.timedOut || result.exitCode === 4)
    throw new RepositoryPreparationError(true, "diff", "timed-out");
  if (result.exitCode !== 0 || result.truncated || result.timedOut)
    throw new RepositoryPreparationError(false, "diff", "unavailable");
  const manifest = JSON.parse(result.stdout) as {
    bytes: number;
    digest: string;
  };
  if (
    !Number.isSafeInteger(manifest.bytes) ||
    manifest.bytes < 0 ||
    manifest.bytes > maximumDiffBytes ||
    !/^[a-f0-9]{64}$/.test(manifest.digest)
  )
    throw new RepositoryPreparationError(false, "diff", "unavailable");
  const bytes = new Uint8Array(manifest.bytes);
  for (let offset = 0; offset < manifest.bytes; offset += pageBytes) {
    const page = await sandbox.run(
      ["node", "-e", readDiffPageScript, diffPath, String(offset)],
      {
        cwd,
        timeoutMs: commandTimeout(deadline, 10_000, "diff"),
        maxOutputBytes: 65_000,
      },
    );
    if (page.exitCode !== 0 || page.truncated || page.timedOut)
      throw new RepositoryPreparationError(false, "diff", "unavailable");
    const decoded = Uint8Array.from(atob(page.stdout), (c) => c.charCodeAt(0));
    if (decoded.length !== Math.min(pageBytes, manifest.bytes - offset))
      throw new RepositoryPreparationError(false, "diff", "unavailable");
    bytes.set(decoded, offset);
  }
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
  if (digest !== manifest.digest)
    throw new RepositoryPreparationError(false, "diff", "integrity-failed");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
