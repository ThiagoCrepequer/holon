import type {
  ExecutorRequest,
  RepositoryToolCall,
  ReviewFileMode,
} from "@holon/contracts";

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

const structuralExtension = /\.(?:[cm]?js|[cm]?ts|jsx|tsx)$/iu;
const excludedDirectory =
  /(?:^|\/)(?:\.git|\.hg|\.svn|node_modules|bower_components|dist|build|coverage|generated|__generated__|vendor|vendors|third[_-]party|pods|target|\.next|\.nuxt|\.output|\.turbo|\.cache|\.terraform|\.venv|venv|site-packages)(?:\/|$)/iu;
const generatedCodeFile =
  /(?:\.(?:generated|gen|pb|designer)|-generated)\.(?:[cm]?[jt]sx?|c|cc|cpp|cs|dart|go|java|kt|kts|php|proto|py|rb|rs|scala|swift|vue)$|\.(?:freezed|g)\.dart$/iu;
const minifiedFile =
  /(?:\.min\.(?:[cm]?[jt]s|[jt]sx|css|html|json|svg)|\.map)$/iu;
const binaryExtension =
  /\.(?:7z|a|ai|apk|avi|avif|bin|bmp|bz2|class|db|der|dll|docx?|dylib|ear|eot|exe|gif|gz|ico|iso|jar|jpe?g|jks|keystore|mov|mp3|mp4|o|ogg|otf|p12|pdf|pfx|png|pptx?|psd|pyc|rar|so|sqlite3?|tar|tiff?|tgz|ttf|war|wasm|wav|webm|webp|woff2?|xlsx?|xz|zip)$/iu;
const secretFile =
  /(?:^|\/)(?:\.env(?:\.(?!example$|sample$|template$)[^/]*)?|\.netrc|\.npmrc|\.pypirc|credentials\.json|id_(?:dsa|ecdsa|ed25519|rsa)|.*\.(?:key|pem))$/iu;
const lockFile =
  /(?:^|\/)(?:\.terraform\.lock\.hcl|bun\.lockb?|cargo\.lock|composer\.lock|deno\.lock|flake\.lock|gemfile\.lock|go\.(?:sum|work\.sum)|gradle\.lockfile|mix\.lock|npm-shrinkwrap\.json|package-lock\.json|package\.resolved|packages\.lock\.json|pipfile\.lock|pnpm-lock\.yaml|podfile\.lock|poetry\.lock|pubspec\.lock|uv\.lock|yarn\.lock|[^/]+\.lock|[^/]+-lock\.json)$/iu;
const ignoredSearchGlobs = [
  "!**/.git/**",
  "!**/.hg/**",
  "!**/.svn/**",
  "!**/node_modules/**",
  "!**/bower_components/**",
  "!**/dist/**",
  "!**/build/**",
  "!**/coverage/**",
  "!**/generated/**",
  "!**/__generated__/**",
  "!**/vendor/**",
  "!**/vendors/**",
  "!**/third_party/**",
  "!**/third-party/**",
  "!**/Pods/**",
  "!**/target/**",
  "!**/.next/**",
  "!**/.nuxt/**",
  "!**/.output/**",
  "!**/.turbo/**",
  "!**/.cache/**",
  "!**/.terraform/**",
  "!**/.venv/**",
  "!**/venv/**",
  "!**/site-packages/**",
  "!**/*.generated.*",
  "!**/*.gen.*",
  "!**/*.pb.*",
  "!**/*.designer.*",
  "!**/*.min.js",
  "!**/*.min.mjs",
  "!**/*.min.cjs",
  "!**/*.min.ts",
  "!**/*.min.mts",
  "!**/*.min.cts",
  "!**/*.min.jsx",
  "!**/*.min.tsx",
  "!**/*.min.css",
  "!**/*.min.html",
  "!**/*.min.json",
  "!**/*.min.svg",
  "!**/*.map",
  "!**/.netrc",
  "!**/.npmrc",
  "!**/.pypirc",
  "!**/credentials.json",
  "!**/id_dsa",
  "!**/id_ecdsa",
  "!**/id_ed25519",
  "!**/id_rsa",
  "!**/*.key",
  "!**/*.pem",
  "!**/*-lock.json",
  "!**/*.lock",
  "!**/go.sum",
  "!**/go.work.sum",
  "!**/pnpm-lock.yaml",
  "!**/yarn.lock",
  "!**/.terraform.lock.hcl",
  "!**/Package.resolved",
  "!**/Podfile.lock",
  "!**/pubspec.lock",
] as const;

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

export function classifyReviewPath(path: string): ReviewFileMode | undefined {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  if (
    !isNormalizedRepositoryPath(path) ||
    excludedDirectory.test(path) ||
    generatedCodeFile.test(basename) ||
    minifiedFile.test(path) ||
    binaryExtension.test(path) ||
    secretFile.test(path) ||
    lockFile.test(path)
  ) {
    return undefined;
  }
  return structuralExtension.test(path) ? "structural" : "textual";
}

export function isReviewablePath(path: string): boolean {
  return classifyReviewPath(path) !== undefined;
}

export function selectReviewableFiles(
  paths: readonly string[],
  maximumFiles: number,
): readonly string[] {
  if (!Number.isSafeInteger(maximumFiles) || maximumFiles <= 0) {
    throw new TypeError("maximumFiles must be a positive safe integer");
  }
  return [...new Set(paths.filter(isReviewablePath))]
    .toSorted()
    .slice(0, maximumFiles);
}

function searchRoots(paths: readonly string[] | undefined): readonly string[] {
  return paths === undefined || paths.length === 0 ? ["."] : paths;
}

function assertReviewablePaths(
  paths: readonly string[] | undefined,
  requiredMode?: ReviewFileMode,
): void {
  for (const path of paths ?? []) {
    const mode = classifyReviewPath(path);
    if (mode === undefined) {
      throw new TypeError("Repository tool path is excluded from review");
    }
    if (requiredMode !== undefined && mode !== requiredMode) {
      throw new TypeError(
        "Structural search path must be JavaScript/TypeScript",
      );
    }
  }
}

function searchGlobArguments(flag: "--glob" | "--globs"): readonly string[] {
  return ignoredSearchGlobs.flatMap((glob) => [flag, glob]);
}

function structuralGlob(language: "javascript" | "jsx" | "tsx" | "typescript") {
  switch (language) {
    case "javascript":
      return "**/*.{js,mjs,cjs}";
    case "jsx":
      return "**/*.jsx";
    case "tsx":
      return "**/*.tsx";
    case "typescript":
      return "**/*.{ts,mts,cts}";
  }
  throw new TypeError("Unsupported structural-search language");
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
