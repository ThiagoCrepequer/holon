import {
  RepositoryConfigurationError,
  type ConfigurationReadResult,
  type ConfigurationSnapshotReader,
} from "@holon/application";
import { configPathSchema, gitShaSchema } from "@holon/contracts";
import { isReviewablePath } from "@holon/repository-analysis";

import { classifyGitHubRequestError } from "./errors.js";

export interface ConfigurationGitTransport {
  request(
    route: string,
    parameters: Record<string, unknown>,
    maximumResponseBytes: number,
  ): Promise<{ data: unknown }>;
}
interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
}
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new RepositoryConfigurationError("invalid_file");
  return value as Record<string, unknown>;
}
function failure(error: unknown): ConfigurationReadResult {
  if (error instanceof RepositoryConfigurationError)
    return {
      kind:
        error.code === "snapshot_mismatch" ||
        error.code === "snapshot_unavailable"
          ? "snapshot_unavailable"
          : error.code === "too_large"
            ? "too_large"
            : "invalid_file",
    };
  const classified = classifyGitHubRequestError(error);
  if (classified.retryable)
    return { kind: "transient_failure", retryAfterMs: classified.retryAfterMs };
  if (classified.statusCode === 401 || classified.statusCode === 403)
    return { kind: "access_denied" };
  return { kind: "snapshot_unavailable" };
}
/** Uses authenticated Git objects, never Contents URLs or a repository-supplied URL. */
export function createConfigurationSnapshotReader(
  transport: ConfigurationGitTransport,
  owner: string,
  repo: string,
  baseSha: string,
): ConfigurationSnapshotReader {
  gitShaSchema.parse(baseSha);
  const trees = new Map<string, readonly TreeEntry[]>();
  let rootSha: string | undefined;
  const root = async () => {
    if (rootSha !== undefined) return rootSha;
    const response = object(
      (
        await transport.request(
          "GET /repos/{owner}/{repo}/git/commits/{commit_sha}",
          { owner, repo, commit_sha: baseSha },
          262_144,
        )
      ).data,
    );
    if (response.sha !== baseSha)
      throw new RepositoryConfigurationError("snapshot_mismatch");
    rootSha = gitShaSchema.parse(object(response.tree).sha);
    return rootSha;
  };
  const tree = async (sha: string) => {
    const cached = trees.get(sha);
    if (cached !== undefined) return cached;
    const response = object(
      (
        await transport.request(
          "GET /repos/{owner}/{repo}/git/trees/{tree_sha}",
          { owner, repo, tree_sha: sha },
          8_388_608,
        )
      ).data,
    );
    if (
      response.sha !== sha ||
      response.truncated !== false ||
      !Array.isArray(response.tree) ||
      response.tree.length > 100_000
    )
      throw new RepositoryConfigurationError("snapshot_unavailable");
    const entries: TreeEntry[] = response.tree.map((item) => {
      const entry = object(item);
      if (
        typeof entry.path !== "string" ||
        entry.path.includes("/") ||
        typeof entry.mode !== "string" ||
        typeof entry.type !== "string"
      )
        throw new RepositoryConfigurationError("invalid_file");
      return {
        path: entry.path,
        mode: entry.mode,
        type: entry.type,
        sha: gitShaSchema.parse(entry.sha),
        ...(typeof entry.size === "number" ? { size: entry.size } : {}),
      };
    });
    if (new Set(entries.map((entry) => entry.path)).size !== entries.length)
      throw new RepositoryConfigurationError("invalid_file");
    if (trees.size >= 256) trees.delete(trees.keys().next().value!);
    trees.set(sha, entries);
    return entries;
  };
  const lookup = async (path: string): Promise<TreeEntry | undefined> => {
    configPathSchema.parse(path);
    let sha = await root();
    const parts = path.split("/");
    for (const [index, component] of parts.entries()) {
      const entry = (await tree(sha)).find((item) => item.path === component);
      if (entry === undefined) return undefined;
      if (index === parts.length - 1) return entry;
      if (entry.mode !== "040000" || entry.type !== "tree")
        throw new RepositoryConfigurationError("invalid_file");
      sha = entry.sha;
    }
    return undefined;
  };
  return {
    isReferenceAllowed: (path, excludes) => isReviewablePath(path, excludes),
    async directoryExists(path) {
      try {
        if (path === ".") {
          await root();
          return true;
        }
        const entry = await lookup(path);
        if (entry === undefined) return false;
        if (entry.mode !== "040000" || entry.type !== "tree")
          throw new RepositoryConfigurationError("invalid_file", path);
        return true;
      } catch (error) {
        if (error instanceof RepositoryConfigurationError) throw error;
        const result = failure(error);
        throw new RepositoryConfigurationError(result.kind, path, {
          retryAfterMs:
            result.kind === "found" ? undefined : result.retryAfterMs,
        });
      }
    },
    async readFile(path, maximumBytes) {
      try {
        if (
          !Number.isSafeInteger(maximumBytes) ||
          maximumBytes <= 0 ||
          maximumBytes > 65_536
        )
          return { kind: "too_large" };
        const entry = await lookup(path);
        if (entry === undefined) return { kind: "absent" };
        if (!["100644", "100755"].includes(entry.mode) || entry.type !== "blob")
          return { kind: "invalid_file" };
        if (entry.size !== undefined && entry.size > maximumBytes)
          return { kind: "too_large" };
        const data = object(
          (
            await transport.request(
              "GET /repos/{owner}/{repo}/git/blobs/{file_sha}",
              { owner, repo, file_sha: entry.sha },
              Math.ceil(maximumBytes / 3) * 4 + 4096,
            )
          ).data,
        );
        if (
          data.sha !== entry.sha ||
          data.encoding !== "base64" ||
          typeof data.content !== "string" ||
          typeof data.size !== "number"
        )
          return { kind: "invalid_file" };
        if (
          data.size > maximumBytes ||
          data.content.length >
            Math.ceil(maximumBytes / 3) * 4 + Math.ceil(maximumBytes / 45) * 2
        )
          return { kind: "too_large" };
        const encoded = data.content.replace(/[\r\n]/gu, "");
        if (
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
            encoded,
          )
        )
          return { kind: "invalid_file" };
        const decoded = atob(encoded);
        if (decoded.length > maximumBytes) return { kind: "too_large" };
        if (
          decoded.length !== data.size ||
          (entry.size !== undefined && decoded.length !== entry.size)
        )
          return { kind: "invalid_file" };
        const bytes = Uint8Array.from(decoded, (character) =>
          character.charCodeAt(0),
        );
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          return { kind: "invalid_file" };
        }
        if (
          Array.from(text).some(
            (character) =>
              character.charCodeAt(0) < 32 &&
              ![9, 10, 13].includes(character.charCodeAt(0)),
          ) ||
          text.startsWith("version https://git-lfs.github.com/spec/")
        )
          return { kind: "invalid_file" };
        return { kind: "found", bytes };
      } catch (error) {
        return failure(error);
      }
    },
  };
}
