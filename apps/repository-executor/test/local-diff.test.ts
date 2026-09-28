import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it } from "vitest";

import { diffGenerationScript, resolveMergeBase } from "../src/local-diff.js";
const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })),
);
it("generates the PR three-dot diff at exact commits beyond GitHub's line limit", () => {
  const root = mkdtempSync(join(tmpdir(), "holon-diff-"));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  writeFileSync(join(root, "code.ts"), "original\n");
  git("add", ".");
  git("commit", "-qm", "initial");
  const ancestor = git("rev-parse", "HEAD");
  git("checkout", "-qb", "base");
  writeFileSync(join(root, "base-only.ts"), "base\n");
  git("add", ".");
  git("commit", "-qm", "base change");
  const base = git("rev-parse", "HEAD");
  git("checkout", "-qb", "head", ancestor);
  writeFileSync(join(root, "code.ts"), "const value = '😀';\n".repeat(21000));
  git("add", ".");
  git("commit", "-qm", "head change");
  const head = git("rev-parse", "HEAD");
  const output = join(root, "output.diff");
  const metadata = JSON.parse(
    execFileSync(
      process.execPath,
      ["-e", diffGenerationScript, ancestor, head, output],
      { cwd: root, encoding: "utf8" },
    ),
  );
  const diff = readFileSync(output, "utf8");
  expect(diff).toBe(
    execFileSync(
      "git",
      [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--find-renames",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        `${base}...${head}`,
        "--",
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 2000000 },
    ),
  );
  expect(diff).not.toContain("base-only.ts");
  expect(diff.split("\n").length).toBeGreaterThan(20000);
  expect(metadata.bytes).toBe(Buffer.byteLength(diff));
  expect(metadata.digest).toMatch(/^[a-f0-9]{64}$/);
});

it("deepens a real shallow checkout and finds an ancestor shared with a fork PR ref", async () => {
  const origin = mkdtempSync(join(tmpdir(), "holon-origin-"));
  const checkout = mkdtempSync(join(tmpdir(), "holon-checkout-"));
  roots.push(origin, checkout);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: origin, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("commit", "--allow-empty", "-qm", "ancestor");
  const ancestor = git("rev-parse", "HEAD");
  const tree = git("rev-parse", "HEAD^{tree}");
  let base = ancestor,
    head = ancestor;
  for (let i = 0; i < 70; i++) {
    base = git("commit-tree", tree, "-p", base, "-m", `base-${i}`);
    head = git("commit-tree", tree, "-p", head, "-m", `fork-${i}`);
  }
  git("update-ref", "refs/heads/base", base);
  git("update-ref", "refs/pull/7/head", head);
  execFileSync("git", ["init", "-q"], { cwd: checkout });
  const depths: string[] = [];
  const run = async (argv: readonly string[]) => {
    if (argv.includes("fetch")) depths.push(argv[3]!);
    const result = spawnSync(
      argv[0] === "node" ? process.execPath : argv[0]!,
      argv.slice(1),
      { cwd: checkout, encoding: "utf8" },
    );
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.status ?? 1,
      truncated: false,
    };
  };
  expect(
    await resolveMergeBase(
      { run },
      { baseSha: base, headSha: head, pullRequestNumber: 7 },
      `file://${origin}`,
      checkout,
    ),
  ).toBe(ancestor);
  expect(depths).toEqual(["--depth=64", "--depth=256"]);
}, 30_000);

it("preserves renames and binary markers without executing external diff or textconv", () => {
  const root = mkdtempSync(join(tmpdir(), "holon-diff-safety-"));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  writeFileSync(join(root, "old.ts"), "export const value = 1;\n");
  writeFileSync(join(root, "binary.dat"), Buffer.from([0, 1, 2]));
  writeFileSync(join(root, ".gitattributes"), "*.dat diff=hostile\n");
  git("add", ".");
  git("commit", "-qm", "initial");
  const base = git("rev-parse", "HEAD");
  git("mv", "old.ts", "new.ts");
  writeFileSync(join(root, "binary.dat"), Buffer.from([0, 3, 4]));
  git("add", ".");
  git("commit", "-qm", "changes");
  git("config", "diff.hostile.command", "false");
  git("config", "diff.hostile.textconv", "false");
  const output = join(root, "output.diff");
  execFileSync(
    process.execPath,
    ["-e", diffGenerationScript, base, git("rev-parse", "HEAD"), output],
    { cwd: root },
  );
  const diff = readFileSync(output, "utf8");
  expect(diff).toContain("rename from old.ts\nrename to new.ts");
  expect(diff).toContain("Binary files a/binary.dat and b/binary.dat differ");
});
