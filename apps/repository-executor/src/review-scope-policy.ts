import {
  classifyReviewPath,
  type PullRequestDiffFile,
} from "@holon/repository-analysis";

export interface ReviewScopePolicy {
  readonly deniedPaths: readonly string[];
  readonly schemaVersion: 1;
}

const maximumPolicyBytes = 500_000;
const maximumDeniedPaths = 10_000;

function canonicalDeniedPaths(paths: readonly string[]): readonly string[] {
  const unique = [...new Set(paths)].toSorted();
  if (
    unique.length > maximumDeniedPaths ||
    unique.some((path) => classifyReviewPath(path) === undefined)
  ) {
    throw new TypeError(
      "Review-scope policy must contain reviewable destinations",
    );
  }
  return unique;
}

export function createReviewScopePolicy(
  files: readonly PullRequestDiffFile[],
): ReviewScopePolicy {
  const deniedPaths = files.flatMap((file) => {
    if (
      (file.changeType !== "renamed" && file.changeType !== "copied") ||
      file.oldPath === undefined ||
      file.newPath === undefined ||
      classifyReviewPath(file.oldPath) !== undefined ||
      classifyReviewPath(file.newPath) === undefined
    ) {
      return [];
    }
    // Persist only the safe-looking destination needed by tool enforcement.
    // The excluded source path and all patch contents remain absent.
    return [file.newPath];
  });
  return { deniedPaths: canonicalDeniedPaths(deniedPaths), schemaVersion: 1 };
}

export function serializeReviewScopePolicy(policy: ReviewScopePolicy): string {
  const serialized = JSON.stringify({
    deniedPaths: canonicalDeniedPaths(policy.deniedPaths),
    schemaVersion: 1,
  });
  if (new TextEncoder().encode(serialized).byteLength > maximumPolicyBytes) {
    throw new RangeError("Review-scope policy exceeds its byte limit");
  }
  return serialized;
}

export function parseReviewScopePolicy(serialized: string): ReviewScopePolicy {
  if (new TextEncoder().encode(serialized).byteLength > maximumPolicyBytes) {
    throw new RangeError("Review-scope policy exceeds its byte limit");
  }
  const value: unknown = JSON.parse(serialized);
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Review-scope policy must be an object");
  }
  const candidate = value as Record<string, unknown>;
  const rawDeniedPaths = candidate.deniedPaths;
  if (
    Object.keys(candidate).toSorted().join("\0") !==
      "deniedPaths\0schemaVersion" ||
    candidate.schemaVersion !== 1 ||
    !Array.isArray(rawDeniedPaths) ||
    rawDeniedPaths.some((path) => typeof path !== "string")
  ) {
    throw new TypeError("Review-scope policy has an invalid shape");
  }
  const deniedPaths = canonicalDeniedPaths(rawDeniedPaths as readonly string[]);
  if (
    deniedPaths.length !== rawDeniedPaths.length ||
    deniedPaths.some((path, index) => path !== rawDeniedPaths[index])
  ) {
    throw new TypeError("Review-scope policy must be canonical");
  }
  return { deniedPaths, schemaVersion: 1 };
}

export function assertReviewScopePathAllowed(
  policy: ReviewScopePolicy,
  path: string,
): void {
  if (policy.deniedPaths.includes(path)) {
    throw new TypeError("Repository tool path is excluded by the run policy");
  }
}

function escapeSearchGlob(path: string): string {
  return path.replace(/[!*[\]{}?\\]/gu, "\\$&");
}

export function withReviewScopeSearchExclusions(
  argv: readonly string[],
  policy: ReviewScopePolicy,
): readonly string[] {
  if (policy.deniedPaths.length === 0) return argv;
  const flag = argv[0] === "rg" ? "--glob" : "--globs";
  if (argv[0] !== "rg" && argv[0] !== "ast-grep") {
    throw new TypeError("Run-scoped exclusions require a trusted search tool");
  }
  const separator = argv.lastIndexOf("--");
  if (separator < 0) {
    throw new TypeError("Search command is missing its argument separator");
  }
  const exclusions = policy.deniedPaths.flatMap((path) => [
    flag,
    `!${escapeSearchGlob(path)}`,
  ]);
  return [...argv.slice(0, separator), ...exclusions, ...argv.slice(separator)];
}
