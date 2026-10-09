import type {
  ExecutorRequest,
  RepositoryToolCall,
  ReviewFileMode,
} from "@holon/contracts";

import {
  classifyReviewPath,
  repositorySearchGlobs,
} from "./review-path-policy.js";

export {
  classifyPullRequestDiffFile,
  classifyReviewPath,
  isReviewablePullRequestDiffFile,
  isReviewablePath,
  repositorySearchGlobs,
  selectReviewableFiles,
} from "./review-path-policy.js";

export interface CommandExecution {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly maxOutputBytes: number;
  readonly stage?: "checkout" | "fetch" | "initialize";
  readonly timeoutMs?: number;
}

export interface ReadFileExecution {
  readonly endLine: number;
  readonly kind: "read_file";
  readonly path: string;
  readonly startLine: number;
}

export type ToolExecution = CommandExecution | ReadFileExecution;

export const trustedAstGrepConfigPath = "/opt/holon/sgconfig.yml";

function assertAbsoluteNormalizedPath(path: string, name: string): void {
  if (
    !path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("/../") ||
    path.includes("/./")
  ) {
    throw new TypeError(`${name} must be a normalized absolute path`);
  }
}

export function buildCheckoutPlan(
  request: ExecutorRequest,
  repositoryPath: string,
  cloneUrl = request.cloneUrl,
): readonly CommandExecution[] {
  assertAbsoluteNormalizedPath(repositoryPath, "repositoryPath");
  const separator = repositoryPath.lastIndexOf("/");
  const workspacePath = repositoryPath.slice(0, separator) || "/";
  return [
    {
      argv: ["git", "init", "--initial-branch=holon", repositoryPath],
      cwd: workspacePath,
      maxOutputBytes: 10_000,
      stage: "initialize",
      timeoutMs: 10_000,
    },
    {
      argv: [
        "git",
        "fetch",
        "--no-tags",
        "--depth=1",
        cloneUrl,
        request.headSha,
        `+refs/pull/${request.pullRequestNumber}/head:refs/holon/head`,
      ],
      cwd: repositoryPath,
      maxOutputBytes: 20_000,
      stage: "fetch",
      timeoutMs: 60_000,
    },
    {
      argv: [
        "git",
        "-c",
        "filter.lfs.smudge=",
        "-c",
        "filter.lfs.process=",
        "-c",
        "filter.lfs.required=false",
        "checkout",
        "--detach",
        "--force",
        request.headSha,
      ],
      cwd: repositoryPath,
      maxOutputBytes: 10_000,
      stage: "checkout",
      timeoutMs: 20_000,
    },
  ];
}

function searchRoots(paths: readonly string[] | undefined): readonly string[] {
  return paths === undefined || paths.length === 0 ? ["."] : paths;
}

/** A model-supplied query violates tool policy; host configuration errors stay fatal. */
export class RepositoryToolPolicyError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryToolPolicyError";
  }
}

function assertReviewablePaths(
  paths: readonly string[] | undefined,
  requiredMode?: ReviewFileMode,
): void {
  for (const path of paths ?? []) {
    const mode = classifyReviewPath(path);
    if (mode === undefined) {
      throw new RepositoryToolPolicyError(
        "Repository tool path is excluded from review",
      );
    }
    if (requiredMode !== undefined && mode !== requiredMode) {
      throw new RepositoryToolPolicyError(
        "Structural search path must be JavaScript/TypeScript",
      );
    }
  }
}

function searchGlobArguments(flag: "--glob" | "--globs"): readonly string[] {
  const globs =
    flag === "--glob"
      ? repositorySearchGlobs
      : repositorySearchGlobs.filter((glob) => glob.startsWith("!"));
  return globs.flatMap((glob) => [flag, glob]);
}

function structuralGlob(
  language: Extract<
    RepositoryToolCall,
    { name: "search_structure" }
  >["arguments"]["language"],
): string {
  switch (language) {
    case "javascript":
      return "**/*.{js,mjs,cjs}";
    case "jsx":
      return "**/*.jsx";
    case "tsx":
      return "**/*.tsx";
    case "typescript":
      return "**/*.{ts,mts,cts}";
    default:
      throw new TypeError("Unsupported structural-search language");
  }
}

export function buildToolExecution(
  call: RepositoryToolCall,
  repositoryPath: string,
): ToolExecution {
  assertAbsoluteNormalizedPath(repositoryPath, "repositoryPath");
  if (call.name === "read_file") {
    assertReviewablePaths([call.arguments.path]);
    const startLine = call.arguments.startLine ?? 1;
    return {
      endLine: call.arguments.endLine ?? startLine + 199,
      kind: "read_file",
      path: `${repositoryPath}/${call.arguments.path}`,
      startLine,
    };
  }
  if (call.name === "search_text") {
    assertReviewablePaths(call.arguments.paths);
    return {
      argv: [
        "rg",
        "--json",
        "--fixed-strings",
        "--max-count",
        String(call.arguments.maxResults),
        ...searchGlobArguments("--glob"),
        "--",
        call.arguments.query,
        ...searchRoots(call.arguments.paths),
      ],
      cwd: repositoryPath,
      maxOutputBytes: Math.min(100_000, call.arguments.maxResults * 10_000),
    };
  }
  assertReviewablePaths(call.arguments.paths, "structural");
  return {
    argv: [
      "ast-grep",
      "run",
      "--config",
      trustedAstGrepConfigPath,
      "--json=stream",
      "--lang",
      call.arguments.language,
      "--pattern",
      call.arguments.pattern,
      "--globs",
      structuralGlob(call.arguments.language),
      ...searchGlobArguments("--globs"),
      "--",
      ...searchRoots(call.arguments.paths),
    ],
    cwd: repositoryPath,
    maxOutputBytes: Math.min(100_000, call.arguments.maxResults * 20_000),
  };
}
