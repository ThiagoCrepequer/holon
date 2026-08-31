import type { ExecutorRequest, RepositoryToolCall } from "@holon/contracts";

export interface CommandExecution {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly maxOutputBytes?: number;
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

const supportedExtension = /\.(?:[cm]?js|[cm]?ts|jsx|tsx)$/iu;
const excludedPath =
  /(?:^|\/)(?:node_modules|dist|build|coverage|generated|vendor)(?:\/|$)|\.min\.[cm]?js$/iu;

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
}

function isNormalizedRepositoryPath(path: string): boolean {
  if (
    path.length === 0 ||
    path.length > 1_024 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    containsControlCharacter(path)
  )
    return false;
  return path
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

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
      stage: "checkout",
      timeoutMs: 20_000,
    },
  ];
}

export function isSupportedSourcePath(path: string): boolean {
  return (
    isNormalizedRepositoryPath(path) &&
    supportedExtension.test(path) &&
    !excludedPath.test(path)
  );
}

export function selectReviewFiles(
  paths: readonly string[],
  maximumFiles: number,
): readonly string[] {
  if (!Number.isSafeInteger(maximumFiles) || maximumFiles <= 0) {
    throw new TypeError("maximumFiles must be a positive safe integer");
  }
  return [...new Set(paths.filter(isSupportedSourcePath))]
    .toSorted()
    .slice(0, maximumFiles);
}

function searchRoots(paths: readonly string[] | undefined): readonly string[] {
  return paths === undefined || paths.length === 0 ? ["."] : paths;
}

export function buildToolExecution(
  call: RepositoryToolCall,
  repositoryPath: string,
): ToolExecution {
  assertAbsoluteNormalizedPath(repositoryPath, "repositoryPath");
  if (call.name === "read_file") {
    const startLine = call.arguments.startLine ?? 1;
    return {
      endLine: call.arguments.endLine ?? startLine + 199,
      kind: "read_file",
      path: `${repositoryPath}/${call.arguments.path}`,
      startLine,
    };
  }
  if (call.name === "search_text") {
    return {
      argv: [
        "rg",
        "--json",
        "--fixed-strings",
        "--max-count",
        String(call.arguments.maxResults),
        "--",
        call.arguments.query,
        ...searchRoots(call.arguments.paths),
      ],
      cwd: repositoryPath,
      maxOutputBytes: Math.min(100_000, call.arguments.maxResults * 10_000),
    };
  }
  return {
    argv: [
      "ast-grep",
      "run",
      "--json=stream",
      "--lang",
      call.arguments.language,
      "--pattern",
      call.arguments.pattern,
      "--",
      ...searchRoots(call.arguments.paths),
    ],
    cwd: repositoryPath,
    maxOutputBytes: Math.min(100_000, call.arguments.maxResults * 20_000),
  };
}
