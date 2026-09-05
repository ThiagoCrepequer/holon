import type { ReviewFileMode } from "@holon/contracts";
import { isProtectedPath } from "@holon/domain";

import type { PullRequestDiffFile } from "./diff.js";
import { matchesAnyPathGlob } from "./glob-matcher.js";

const structuralExtension = /\.(?:[cm]?js|[cm]?ts|jsx|tsx)$/iu;

const excludedDirectories = [
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "bower_components",
  "dist",
  "build",
  "coverage",
  "generated",
  "__generated__",
  "vendor",
  "vendors",
  "third_party",
  "third-party",
  "Pods",
  "target",
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
  ".cache",
  ".terraform",
  ".venv",
  "venv",
  "site-packages",
] as const;
const excludedDirectoryNames = new Set(
  excludedDirectories.map((directory) => directory.toLowerCase()),
);

const generatedMarkers = [
  ".generated",
  ".gen",
  ".pb",
  ".designer",
  "-generated",
] as const;
const generatedExtensions = [
  "c",
  "cc",
  "cpp",
  "cs",
  "cts",
  "dart",
  "go",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "kts",
  "mjs",
  "mts",
  "php",
  "proto",
  "py",
  "rb",
  "rs",
  "scala",
  "swift",
  "ts",
  "tsx",
  "vue",
  "yaml",
  "yml",
] as const;
const generatedExtensionNames = new Set<string>(generatedExtensions);
const generatedSuffixes = [".freezed.dart", ".g.dart"] as const;

const minifiedExtensions = [
  "js",
  "mjs",
  "cjs",
  "ts",
  "mts",
  "cts",
  "jsx",
  "tsx",
  "css",
  "html",
  "json",
  "svg",
] as const;
const binaryExtensions = [
  "7z",
  "a",
  "ai",
  "apk",
  "avi",
  "avif",
  "bin",
  "bmp",
  "bz2",
  "class",
  "db",
  "der",
  "dll",
  "doc",
  "docx",
  "dylib",
  "ear",
  "eot",
  "exe",
  "gif",
  "gz",
  "ico",
  "iso",
  "jar",
  "jpeg",
  "jpg",
  "jks",
  "keystore",
  "mov",
  "mp3",
  "mp4",
  "o",
  "ogg",
  "otf",
  "p12",
  "pdf",
  "pfx",
  "png",
  "ppt",
  "pptx",
  "psd",
  "pyc",
  "rar",
  "so",
  "sqlite",
  "sqlite2",
  "sqlite3",
  "tar",
  "tiff",
  "tif",
  "tgz",
  "ttf",
  "war",
  "wasm",
  "wav",
  "webm",
  "webp",
  "woff",
  "woff2",
  "xls",
  "xlsx",
  "xz",
  "zip",
] as const;
const binaryExtensionNames = new Set<string>(binaryExtensions);

const safeEnvironmentFiles = [
  ".env.example",
  ".env.sample",
  ".env.template",
] as const;
const safeEnvironmentFileNames = new Set<string>(safeEnvironmentFiles);
const secretBasenames = [
  ".netrc",
  ".npmrc",
  ".pypirc",
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
] as const;
const secretBaseNames = new Set<string>(secretBasenames);
const secretExtensions = ["key", "pem"] as const;
const secretExtensionNames = new Set<string>(secretExtensions);

const lockBasenames = [
  ".terraform.lock.hcl",
  "bun.lockb",
  "go.sum",
  "go.work.sum",
  "gradle.lockfile",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "Package.resolved",
  "packages.lock.json",
  "pnpm-lock.yaml",
  "Podfile.lock",
  "pubspec.lock",
  "yarn.lock",
] as const;
const lockBaseNames = new Set(
  lockBasenames.map((basename) => basename.toLowerCase()),
);
const lockSuffixes = [".lock", "-lock.json"] as const;

function extension(path: string): string | undefined {
  const separator = path.lastIndexOf(".");
  return separator < 0 ? undefined : path.slice(separator + 1).toLowerCase();
}

function isGeneratedFile(basename: string): boolean {
  const normalized = basename.toLowerCase();
  const fileExtension = extension(normalized);
  return (
    (fileExtension !== undefined &&
      generatedExtensionNames.has(fileExtension) &&
      generatedMarkers.some((marker) =>
        normalized.endsWith(`${marker}.${fileExtension}`),
      )) ||
    generatedSuffixes.some((suffix) => normalized.endsWith(suffix))
  );
}

function isMinifiedFile(basename: string): boolean {
  const normalized = basename.toLowerCase();
  return (
    normalized.endsWith(".map") ||
    minifiedExtensions.some((suffix) => normalized.endsWith(`.min.${suffix}`))
  );
}

function isSecretFile(basename: string): boolean {
  const normalized = basename.toLowerCase();
  if (safeEnvironmentFileNames.has(normalized)) return false;
  return (
    normalized === ".env" ||
    normalized.startsWith(".env.") ||
    secretBaseNames.has(normalized) ||
    secretExtensionNames.has(extension(normalized) ?? "")
  );
}

function isLockFile(basename: string): boolean {
  const normalized = basename.toLowerCase();
  return (
    lockBaseNames.has(normalized) ||
    lockSuffixes.some((suffix) => normalized.endsWith(suffix))
  );
}

function isExcludedDirectory(path: string): boolean {
  return path
    .split("/")
    .some((segment) => excludedDirectoryNames.has(segment.toLowerCase()));
}

function braceGlob(values: readonly string[]): string {
  return values.length === 1 ? values[0]! : `{${values.join(",")}}`;
}

function caseInsensitiveGlob(glob: string): string {
  return glob.replace(/[a-z]/giu, (letter) => {
    const lowerCase = letter.toLowerCase();
    return `[${lowerCase}${lowerCase.toUpperCase()}]`;
  });
}

function withCaseInsensitiveVariants(
  globs: readonly string[],
): readonly string[] {
  return globs.flatMap((glob) => [glob, caseInsensitiveGlob(glob)]);
}

const secretSearchGlobs = [
  "!**/.env",
  "!**/.env.*",
  ...safeEnvironmentFiles.map((basename) => `**/${basename}`),
  ...secretBasenames.map((basename) => `!**/${basename}`),
  `!**/*.${braceGlob(secretExtensions)}`,
] as const;
const directorySearchGlobs = excludedDirectories.map(
  (directory) => `!**/${directory}/**`,
);
const generatedSearchGlobs = [
  ...generatedMarkers.map(
    (marker) => `!**/*${marker}.${braceGlob(generatedExtensions)}`,
  ),
  ...generatedSuffixes.map((suffix) => `!**/*${suffix}`),
];
const minifiedSearchGlobs = [
  ...minifiedExtensions.map((suffix) => `!**/*.min.${suffix}`),
  "!**/*.map",
];
const binarySearchGlobs = [`!**/*.${braceGlob(binaryExtensions)}`] as const;
const lockSearchGlobs = [
  ...lockSuffixes.map((suffix) => `!**/*${suffix}`),
  ...lockBasenames.map((basename) => `!**/${basename}`),
];

/**
 * Search exclusions are derived from the same path-policy data used by
 * classifyReviewPath. Positive entries restore the explicitly safe `.env`
 * templates after the fail-closed environment-file exclusion.
 */
export const repositorySearchGlobs = [
  "**/*",
  ...withCaseInsensitiveVariants(secretSearchGlobs),
  ...withCaseInsensitiveVariants(directorySearchGlobs),
  ...withCaseInsensitiveVariants(generatedSearchGlobs),
  ...withCaseInsensitiveVariants(minifiedSearchGlobs),
  ...withCaseInsensitiveVariants(binarySearchGlobs),
  ...withCaseInsensitiveVariants(lockSearchGlobs),
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

/** Metadata callers must also enforce their own source-name allowlist. */
export function isProjectMetadataPathAllowed(
  path: string,
  additionalExcludes: readonly string[],
): boolean {
  if (!isNormalizedRepositoryPath(path)) return false;
  const basename = path.slice(path.lastIndexOf("/") + 1);
  return (
    !isExcludedDirectory(path) &&
    !isGeneratedFile(basename) &&
    !isMinifiedFile(basename) &&
    !binaryExtensionNames.has(extension(basename) ?? "") &&
    !isSecretFile(basename) &&
    !matchesAnyPathGlob(path, additionalExcludes)
  );
}

export function classifyReviewPath(
  path: string,
  additionalExcludes?: readonly string[],
): ReviewFileMode | undefined {
  if (!isNormalizedRepositoryPath(path)) return undefined;
  if (isProtectedPath(path)) {
    return structuralExtension.test(path) ? "structural" : "textual";
  }
  const basename = path.slice(path.lastIndexOf("/") + 1);
  if (
    isExcludedDirectory(path) ||
    isGeneratedFile(basename) ||
    isMinifiedFile(basename) ||
    binaryExtensionNames.has(extension(basename) ?? "") ||
    isSecretFile(basename) ||
    isLockFile(basename)
  ) {
    return undefined;
  }
  if (
    additionalExcludes !== undefined &&
    additionalExcludes.length > 0 &&
    matchesAnyPathGlob(path, additionalExcludes)
  ) {
    return undefined;
  }
  return structuralExtension.test(path) ? "structural" : "textual";
}

function hasCompatibleDiffPaths(file: PullRequestDiffFile): boolean {
  switch (file.changeType) {
    case "added":
      return (
        file.oldPath === undefined &&
        file.newPath !== undefined &&
        file.path === file.newPath
      );
    case "deleted":
      return (
        file.oldPath !== undefined &&
        file.newPath === undefined &&
        file.path === file.oldPath
      );
    case "modified":
      return (
        file.oldPath !== undefined &&
        file.newPath !== undefined &&
        file.oldPath === file.newPath &&
        file.path === file.newPath
      );
    case "copied":
    case "renamed":
      return (
        file.oldPath !== undefined &&
        file.newPath !== undefined &&
        file.oldPath !== file.newPath &&
        file.path === file.newPath
      );
    default:
      return false;
  }
}

/**
 * Applies the run-scoped path policy to every side of a Git change. In
 * particular, a rename or copy cannot make an excluded source reviewable by
 * moving it to an otherwise safe destination (or vice versa).
 */
export function classifyPullRequestDiffFile(
  file: PullRequestDiffFile,
  additionalExcludes?: readonly string[],
): ReviewFileMode | undefined {
  if (!hasCompatibleDiffPaths(file)) return undefined;
  const paths = [file.oldPath, file.newPath].filter(
    (path): path is string => path !== undefined,
  );
  if (
    paths.some(
      (path) => classifyReviewPath(path, additionalExcludes) === undefined,
    )
  ) {
    return undefined;
  }
  return classifyReviewPath(file.path, additionalExcludes);
}

export function isReviewablePullRequestDiffFile(
  file: PullRequestDiffFile,
  additionalExcludes?: readonly string[],
): boolean {
  return classifyPullRequestDiffFile(file, additionalExcludes) !== undefined;
}

export function isReviewablePath(
  path: string,
  additionalExcludes?: readonly string[],
): boolean {
  return classifyReviewPath(path, additionalExcludes) !== undefined;
}

export function selectReviewableFiles(
  paths: readonly string[],
  maximumFiles: number,
  additionalExcludes?: readonly string[],
): readonly string[] {
  if (!Number.isSafeInteger(maximumFiles) || maximumFiles <= 0) {
    throw new TypeError("maximumFiles must be a positive safe integer");
  }
  return [
    ...new Set(paths.filter((p) => isReviewablePath(p, additionalExcludes))),
  ]
    .toSorted()
    .slice(0, maximumFiles);
}
