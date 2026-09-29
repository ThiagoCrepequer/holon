import { repositoryPolicyGlobSchema } from "@holon/contracts";
import { isProtectedPath } from "@holon/domain";
import {
  classifyReviewPath,
  matchesAnyPathGlob,
  type PullRequestDiffFile,
} from "@holon/repository-analysis";

export interface ReviewScopePolicy {
  readonly additionalExcludes: readonly string[];
  readonly deniedPaths: readonly string[];
}

import { RepositoryQueryError } from "./repository-tool-failure.js";

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

function canonicalAdditionalExcludes(
  paths: readonly string[],
): readonly string[] {
  return repositoryPolicyGlobSchema.array().max(50).parse(paths).toSorted();
}

export function createReviewScopePolicy(
  files: readonly PullRequestDiffFile[],
  additionalExcludes: readonly string[] = [],
): ReviewScopePolicy {
  const canonicalExcludes = canonicalAdditionalExcludes([
    ...new Set(additionalExcludes),
  ]);
  const deniedPaths = files.flatMap((file) => {
    if (
      (file.changeType !== "renamed" && file.changeType !== "copied") ||
      file.oldPath === undefined ||
      file.newPath === undefined ||
      classifyReviewPath(file.oldPath, canonicalExcludes) !== undefined ||
      classifyReviewPath(file.newPath, canonicalExcludes) === undefined
    ) {
      return [];
    }
    // Persist only the safe-looking destination needed by tool enforcement.
    // The excluded source path and all patch contents remain absent.
    return [file.newPath];
  });
  return {
    additionalExcludes: canonicalExcludes,
    deniedPaths: canonicalDeniedPaths(deniedPaths),
  };
}

export function serializeReviewScopePolicy(policy: ReviewScopePolicy): string {
  const serialized = JSON.stringify({
    additionalExcludes: canonicalAdditionalExcludes([
      ...new Set(policy.additionalExcludes),
    ]),
    deniedPaths: canonicalDeniedPaths(policy.deniedPaths),
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
  const rawAdditionalExcludes = candidate.additionalExcludes;

  if (
    Object.keys(candidate).some(
      (key) => key !== "deniedPaths" && key !== "additionalExcludes",
    ) ||
    !Array.isArray(rawDeniedPaths) ||
    rawDeniedPaths.some((path) => typeof path !== "string") ||
    !Array.isArray(rawAdditionalExcludes) ||
    rawAdditionalExcludes.some((path) => typeof path !== "string")
  ) {
    throw new TypeError("Review-scope policy has an invalid shape");
  }

  const deniedPaths = canonicalDeniedPaths(rawDeniedPaths as readonly string[]);
  const additionalExcludes = canonicalAdditionalExcludes([
    ...new Set(rawAdditionalExcludes as readonly string[]),
  ]);

  return {
    additionalExcludes,
    deniedPaths,
  };
}

export function assertReviewScopePathAllowed(
  policy: ReviewScopePolicy,
  path: string,
): void {
  if (isProtectedPath(path)) return;
  if (policy.deniedPaths.includes(path)) {
    throw new RepositoryQueryError("path_denied");
  }
  if (
    policy.additionalExcludes.length > 0 &&
    matchesAnyPathGlob(path, policy.additionalExcludes)
  ) {
    throw new RepositoryQueryError("path_denied");
  }
}

function escapeSearchGlob(path: string): string {
  return path.replace(/[!*[\]{}?\\]/gu, "\\$&");
}

export function withReviewScopeSearchExclusions(
  argv: readonly string[],
  policy: ReviewScopePolicy,
): readonly string[] {
  if (
    policy.deniedPaths.length === 0 &&
    policy.additionalExcludes.length === 0
  ) {
    return argv;
  }
  const flag = argv[0] === "rg" ? "--glob" : "--globs";
  if (argv[0] !== "rg" && argv[0] !== "ast-grep") {
    throw new TypeError("Run-scoped exclusions require a trusted search tool");
  }
  const separator = argv.lastIndexOf("--");
  if (separator < 0) {
    throw new TypeError("Search command is missing its argument separator");
  }
  const deniedExclusions = policy.deniedPaths.flatMap((path) => [
    flag,
    `!${escapeSearchGlob(path)}`,
  ]);
  const customExclusions = policy.additionalExcludes.flatMap((glob) => [
    flag,
    `!${glob}`,
  ]);
  return [
    ...argv.slice(0, separator),
    ...deniedExclusions,
    ...customExclusions,
    ...argv.slice(separator),
  ];
}
