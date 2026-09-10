import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, expect, it } from "vitest";

import { localConfigurationReader } from "../local-reader.js";

const execute = promisify(execFile);
const directories: string[] = [];
async function repository() {
  const path = await mkdtemp(join(tmpdir(), "holon-config-cli-"));
  directories.push(path);
  await execute("git", ["-C", path, "init", "--quiet"]);
  await execute("git", [
    "-C",
    path,
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--allow-empty",
    "--quiet",
    "-m",
    "fixture",
  ]);
  return path;
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
it("reads the working tree with byte limits and exact case", async () => {
  const path = await repository();
  await mkdir(join(path, "docs"));
  await writeFile(join(path, "docs/Guide.md"), "éé");
  const { reader, mode } = await localConfigurationReader(path);
  expect(mode).toBe("working-tree");
  expect(reader.isReferenceAllowed(".env", [])).toBe(false);
  expect(reader.isReferenceAllowed("docs/Guide.md", ["docs/**"])).toBe(false);
  expect(reader.isReferenceAllowed("docs/Guide.md", [])).toBe(true);
  expect(await reader.readFile("docs/Guide.md", 4)).toEqual({
    kind: "found",
    bytes: Buffer.from("éé"),
  });
  expect(await reader.readFile("docs/Guide.md", 3)).toEqual({
    kind: "too_large",
  });
  expect(await reader.readFile("docs/guide.md", 10)).toEqual({
    kind: "absent",
  });
  expect(await reader.directoryExists("docs")).toBe(true);
  expect(await reader.directoryExists("missing")).toBe(false);
  expect(await reader.readFile("docs", 100)).toEqual({ kind: "invalid_file" });
});
it("rejects symlinks at the final path and in every parent component", async () => {
  const path = await repository();
  await mkdir(join(path, "docs"));
  await writeFile(join(path, "docs/guidance.md"), "private");
  await symlink("docs", join(path, "linked"));
  await symlink("docs/guidance.md", join(path, "guidance.md"));
  const { reader } = await localConfigurationReader(path);
  expect(await reader.readFile("linked/guidance.md", 100)).toEqual({
    kind: "invalid_file",
  });
  expect(await reader.readFile("guidance.md", 100)).toEqual({
    kind: "invalid_file",
  });
  await expect(reader.directoryExists("linked")).rejects.toThrow(
    "invalid_file",
  );
  expect(await reader.readFile("../outside", 100)).toEqual({
    kind: "invalid_file",
  });
});
it("reads exact Git objects without checking out the requested commit", async () => {
  const path = await repository();
  await mkdir(join(path, "docs"));
  await writeFile(join(path, "docs/guide.md"), "base");
  await symlink("docs/guide.md", join(path, "link.md"));
  await execute("git", ["-C", path, "add", "."]);
  await execute("git", [
    "-C",
    path,
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--quiet",
    "-m",
    "source",
  ]);
  await writeFile(join(path, "docs/guide.md"), "working");
  const { reader, mode } = await localConfigurationReader(path, "HEAD");
  expect(mode).toBe("git-object");
  expect(await reader.readFile("docs/guide.md", 4)).toEqual({
    kind: "found",
    bytes: Buffer.from("base"),
  });
  expect(await reader.readFile("docs/guide.md", 3)).toEqual({
    kind: "too_large",
  });
  expect(await reader.readFile("missing.md", 100)).toEqual({ kind: "absent" });
  expect(await reader.readFile("link.md", 100)).toEqual({
    kind: "invalid_file",
  });
  expect(await reader.directoryExists("docs")).toBe(true);
  expect(await reader.directoryExists(".")).toBe(true);
});
it("explains source chains without printing instruction contents and uses the invocation directory", async () => {
  const path = await repository();
  await writeFile(
    join(path, ".holon.yml"),
    "output:\n  language: pt-BR\ninstructions:\n  - private-guidance-do-not-print\n",
  );
  const cli = fileURLToPath(new URL("../cli.ts", import.meta.url));
  const cwd = fileURLToPath(new URL("../", import.meta.url));
  const result = await execute(
    process.execPath,
    ["--import", "tsx", cli, "config", "explain", "--path", "src/index.ts"],
    { cwd, env: { ...process.env, INIT_CWD: path }, timeout: 10_000 },
  );
  expect(result.stdout).not.toContain("private-guidance-do-not-print");
  expect(JSON.parse(result.stdout)).toMatchObject({
    mode: "working-tree",
    output: { language: "pt-BR" },
    scope: [
      {
        path: "src/index.ts",
        instructions: [{ origin: "instructions[0]", path: null }],
      },
    ],
  });
  await expect(
    execute(process.execPath, ["--import", "tsx", cli, "config", "invalid"], {
      cwd,
      timeout: 10_000,
    }),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("usage:"),
  });
  // Two real TypeScript CLI processes plus Git setup can exceed the unit-test
  // timeout when the CI runner also executes the other workspace coverage jobs.
}, 30_000);
