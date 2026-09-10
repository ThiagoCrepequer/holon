import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath, readdir } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";

import {
  RepositoryConfigurationError,
  type ConfigurationSnapshotReader,
} from "@holon/application";
import { configPathSchema } from "@holon/contracts";
import { isReviewablePath } from "@holon/repository-analysis";
const execute = promisify(execFile);

export async function localConfigurationReader(
  directory: string,
  ref?: string,
): Promise<{
  reader: ConfigurationSnapshotReader;
  sha: string;
  mode: "working-tree" | "git-object";
}> {
  const root = await realpath(directory);
  const git = async (args: string[], maximum = 131072) =>
    (
      await execute("git", ["-C", root, ...args], {
        encoding: "buffer",
        maxBuffer: maximum,
      })
    ).stdout;
  const sha = (
    await git([
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${ref ?? "HEAD"}^{commit}`,
    ])
  )
    .toString("utf8")
    .trim();
  if (!/^[a-f0-9]{40}$/u.test(sha))
    throw new RepositoryConfigurationError("snapshot_unavailable");
  const diskPath = async (path: string) => {
    configPathSchema.parse(path);
    let current = root;
    for (const part of path.split("/")) {
      if (!(await readdir(current)).includes(part))
        throw Object.assign(new Error("Path absent"), { code: "ENOENT" });
      current = resolve(current, part);
      if (!current.startsWith(`${root}${sep}`))
        throw new RepositoryConfigurationError("invalid_file");
      const stat = await lstat(current);
      if (stat.isSymbolicLink())
        throw new RepositoryConfigurationError("invalid_file");
    }
    return current;
  };
  const gitEntry = async (path: string) => {
    configPathSchema.parse(path);
    let tree = sha;
    for (const [index, part] of path.split("/").entries()) {
      const listing = (
        await git(["ls-tree", "-z", tree], 8 * 1024 * 1024)
      ).toString("utf8");
      const entry = listing
        .split("\0")
        .map((line) =>
          /^(\d+) (blob|tree|commit) ([a-f0-9]{40})\t(.*)$/u.exec(line),
        )
        .find((match) => match?.[4] === part);
      if (entry === undefined || entry === null) return undefined;
      const result = { mode: entry[1]!, type: entry[2]!, sha: entry[3]! };
      if (index === path.split("/").length - 1) return result;
      if (result.mode !== "040000" || result.type !== "tree")
        throw new RepositoryConfigurationError("invalid_file");
      tree = result.sha;
    }
    return undefined;
  };
  const reader: ConfigurationSnapshotReader = {
    isReferenceAllowed: (path, excludes) => isReviewablePath(path, excludes),
    async directoryExists(path) {
      if (path === ".") return true;
      if (ref !== undefined) {
        const entry = await gitEntry(path);
        return entry?.type === "tree" && entry.mode === "040000";
      }
      try {
        return (await lstat(await diskPath(path))).isDirectory();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    },
    async readFile(path, maximumBytes) {
      try {
        if (ref !== undefined) {
          const entry = await gitEntry(path);
          if (entry === undefined) return { kind: "absent" };
          if (
            entry.type !== "blob" ||
            !["100644", "100755"].includes(entry.mode)
          )
            return { kind: "invalid_file" };
          const size = Number(
            (await git(["cat-file", "-s", entry.sha])).toString("utf8"),
          );
          if (!Number.isSafeInteger(size) || size > maximumBytes)
            return { kind: "too_large" };
          return {
            kind: "found",
            bytes: await git(["cat-file", "blob", entry.sha], maximumBytes + 1),
          };
        }
        const absolute = await diskPath(path);
        const stat = await lstat(absolute);
        if (!stat.isFile()) return { kind: "invalid_file" };
        if (stat.size > maximumBytes) return { kind: "too_large" };
        const handle = await open(
          absolute,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
          const opened = await handle.stat();
          if (
            !opened.isFile() ||
            opened.dev !== stat.dev ||
            opened.ino !== stat.ino ||
            (await realpath(absolute)) !== absolute
          )
            return { kind: "invalid_file" };
          const buffer = Buffer.alloc(maximumBytes + 1);
          let offset = 0;
          while (offset < buffer.length) {
            const result = await handle.read(
              buffer,
              offset,
              buffer.length - offset,
              null,
            );
            if (result.bytesRead === 0) break;
            offset += result.bytesRead;
          }
          if (offset > maximumBytes) return { kind: "too_large" };
          if (
            (await diskPath(path)) !== absolute ||
            (await realpath(absolute)) !== absolute
          )
            return { kind: "invalid_file" };
          return { kind: "found", bytes: buffer.subarray(0, offset) };
        } finally {
          await handle.close();
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return { kind: "absent" };
        return { kind: "invalid_file" };
      }
    },
  };
  return {
    reader,
    sha,
    mode: ref === undefined ? "working-tree" : "git-object",
  };
}
