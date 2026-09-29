import {
  repositoryToolCallSchema,
  reviewContextSchema,
  runIdSchema,
  type RepositoryToolCall,
  type ReviewContext,
} from "@holon/contracts";
import {
  buildToolExecution,
  RepositoryToolPolicyError,
  classifyReviewPath,
  matchesAnyPathGlob,
} from "@holon/repository-analysis";

import { RepositoryQueryError } from "./repository-tool-failure.js";
import {
  assertReviewScopePathAllowed,
  parseReviewScopePolicy,
  withReviewScopeSearchExclusions,
  type ReviewScopePolicy,
} from "./review-scope-policy.js";
import { SandboxRuntimeError } from "./sandbox-errors.js";
import type { SandboxCommandResult, SandboxPort } from "./sandbox-port.js";

export const repositoryPath = "/workspace/repository";
export const contextPath = "/workspace/holon-review-context.json";
export const reviewScopePolicyPath = "/workspace/holon-review-scope.json";

function assertSuccessful(result: SandboxCommandResult): void {
  if (result.timedOut === true) {
    throw new SandboxRuntimeError(true, "timed-out");
  }
  if (result.exitCode !== 0) {
    throw new Error(
      `Repository command failed with exit code ${result.exitCode}`,
    );
  }
}

function limitUtf8(
  value: string,
  maximumBytes: number,
): { readonly content: string; readonly truncated: boolean } {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= maximumBytes)
    return { content: value, truncated: false };
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let end = maximumBytes;
  while (end > 0) {
    try {
      return {
        content: decoder.decode(encoded.slice(0, end)),
        truncated: true,
      };
    } catch {
      end -= 1;
    }
  }
  return { content: "", truncated: true };
}

function searchResultPath(
  call: Exclude<RepositoryToolCall, { readonly name: "read_file" }>,
  line: string,
): string | undefined {
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== "object" || value === null) return undefined;
    if (call.name === "search_structure") {
      if (!("file" in value) || typeof value.file !== "string")
        return undefined;
      return value.file.replace(/^\.\//u, "");
    }
    if (!("type" in value) || value.type !== "match" || !("data" in value))
      return undefined;
    const data = value.data;
    if (
      typeof data !== "object" ||
      data === null ||
      !("path" in data) ||
      typeof data.path !== "object" ||
      data.path === null ||
      !("text" in data.path) ||
      typeof data.path.text !== "string"
    ) {
      return undefined;
    }
    return data.path.text.replace(/^\.\//u, "");
  } catch {
    return undefined;
  }
}

function boundSearchOutput(
  call: Exclude<RepositoryToolCall, { readonly name: "read_file" }>,
  content: string,
  policy: ReviewScopePolicy,
): { readonly content: string; readonly truncated: boolean } {
  const lines = content
    .split("\n")
    .filter((line) => line.length > 0)
    .filter((line) => {
      const path = searchResultPath(call, line);
      const mode =
        path === undefined
          ? undefined
          : classifyReviewPath(path, policy.additionalExcludes);
      return (
        mode !== undefined &&
        !policy.deniedPaths.includes(path ?? "") &&
        !matchesAnyPathGlob(path ?? "", policy.additionalExcludes) &&
        (call.name !== "search_structure" || mode === "structural")
      );
    });
  const selected = lines.slice(0, call.arguments.maxResults).join("\n");
  const bounded = limitUtf8(selected, 100_000);
  return {
    content: bounded.content,
    truncated: bounded.truncated || lines.length > call.arguments.maxResults,
  };
}

async function resolveReviewablePaths(
  sandbox: SandboxPort,
  paths: readonly string[],
  policy: ReviewScopePolicy,
): Promise<readonly string[]> {
  if (paths.length === 0) return [];
  const resolved = await sandbox.run(
    [
      "realpath",
      "--canonicalize-existing",
      "--",
      ...paths.map((path) => `${repositoryPath}/${path}`),
    ],
    {
      cwd: repositoryPath,
      maxOutputBytes: Math.min(50_000, paths.length * 2_048),
      timeoutMs: 10_000,
    },
  );
  if (!resolved.timedOut && resolved.exitCode === 1)
    throw new RepositoryQueryError("path_unavailable");
  assertSuccessful(resolved);
  const resolvedPaths = resolved.stdout.trimEnd().split("\n");
  if (resolved.truncated || resolvedPaths.length !== paths.length) {
    throw new Error("Repository tool paths could not be resolved safely");
  }
  for (const resolvedPath of resolvedPaths) {
    if (!resolvedPath.startsWith(`${repositoryPath}/`)) {
      throw new RepositoryQueryError("path_denied");
    }
    const relativePath = resolvedPath.slice(repositoryPath.length + 1);
    assertReviewScopePathAllowed(policy, relativePath);
    if (classifyReviewPath(relativePath) === undefined) {
      throw new RepositoryQueryError("path_denied");
    }
  }
  return resolvedPaths;
}

function hasStructuralReviewFiles(context: ReviewContext): boolean {
  return context.files.some((file) => file.mode === "structural");
}

export async function executeRepositoryTool(
  sandbox: SandboxPort,
  rawRunId: string,
  rawCall: RepositoryToolCall,
): Promise<{ readonly content: string; readonly truncated: boolean }> {
  runIdSchema.parse(rawRunId);
  const call = repositoryToolCallSchema.parse(rawCall);
  const policy = parseReviewScopePolicy(
    await sandbox.readFile(reviewScopePolicyPath),
  );
  for (const path of call.name === "read_file"
    ? [call.arguments.path]
    : (call.arguments.paths ?? [])) {
    assertReviewScopePathAllowed(policy, path);
  }
  if (call.name === "search_structure") {
    const context = reviewContextSchema.parse(
      JSON.parse(await sandbox.readFile(contextPath)) as unknown,
    );
    if (!hasStructuralReviewFiles(context)) {
      throw new RepositoryQueryError("query_unsupported");
    }
  }
  let execution: ReturnType<typeof buildToolExecution>;
  try {
    execution = buildToolExecution(call, repositoryPath);
  } catch (error) {
    if (error instanceof RepositoryToolPolicyError)
      throw new RepositoryQueryError("path_denied");
    throw error;
  }
  if (call.name === "read_file") {
    if (!("kind" in execution))
      throw new TypeError("Read-file policy returned a command execution");
    const [resolvedPath] = await resolveReviewablePaths(
      sandbox,
      [call.arguments.path],
      policy,
    );
    if (resolvedPath === undefined)
      throw new Error("Repository file path could not be resolved safely");
    const result = await sandbox.run(
      [
        "sed",
        "-n",
        "-e",
        `${execution.startLine},${execution.endLine}p`,
        resolvedPath,
      ],
      {
        cwd: repositoryPath,
        maxOutputBytes: 100_000,
        timeoutMs: 20_000,
      },
    );
    assertSuccessful(result);
    const content = result.stdout.endsWith("\n")
      ? result.stdout.slice(0, -1)
      : result.stdout;
    const bounded = limitUtf8(content, 100_000);
    return {
      content: bounded.content,
      truncated: result.truncated || bounded.truncated,
    };
  }
  if ("kind" in execution)
    throw new TypeError("Search policy returned a read-file execution");
  await resolveReviewablePaths(sandbox, call.arguments.paths ?? [], policy);
  const result = await sandbox.run(
    withReviewScopeSearchExclusions(execution.argv, policy),
    {
      cwd: execution.cwd,
      ...(execution.maxOutputBytes === undefined
        ? {}
        : { maxOutputBytes: execution.maxOutputBytes }),
      timeoutMs: 20_000,
    },
  );
  if (
    result.timedOut === true ||
    (result.exitCode !== 0 && result.exitCode !== 1)
  ) {
    assertSuccessful(result);
  }
  const bounded = boundSearchOutput(call, result.stdout, policy);
  return {
    content: bounded.content,
    truncated: result.truncated || bounded.truncated,
  };
}
