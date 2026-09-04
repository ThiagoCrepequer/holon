const maximumCachedGlobs = 256;
const globRegexCache = new Map<string, RegExp>();

export const PROTECTED_POLICY_PATHS = [
  ".github/holon.yml",
  ".github/holon.yaml",
  ".holon.yml",
  ".holon.yaml",
  ".github/workflows",
  "security.md",
  ".github/security.md",
  "codeowners",
  ".github/codeowners",
  "docs/codeowners",
] as const;

export function isProtectedPath(path: string): boolean {
  const normalized = path.toLowerCase().replace(/^\/+|\/+$/gu, "");
  return PROTECTED_POLICY_PATHS.some((protectedPath) => {
    return (
      normalized === protectedPath ||
      normalized.startsWith(`${protectedPath}/`) ||
      normalized.startsWith(`${protectedPath}.`)
    );
  });
}

export function globToRegex(glob: string): RegExp {
  const cached = globRegexCache.get(glob);
  if (cached !== undefined) return cached;

  const normalized = glob.replace(/^\/+|\/+$/gu, "");
  const hasSlash = normalized.includes("/");
  let regex = "";
  let index = 0;

  while (index < normalized.length) {
    const character = normalized[index];
    if (character === "*") {
      if (normalized[index + 1] === "*") {
        if (normalized[index + 2] === "/") {
          regex += "(?:.*/)?";
          index += 3;
          continue;
        }
        regex += ".*";
        index += 2;
        continue;
      }
      regex += "[^/]*";
      index += 1;
      continue;
    }
    if (character === "?") {
      regex += "[^/]";
      index += 1;
      continue;
    }
    if (character !== undefined && ".+()$^[]{}|\\".includes(character)) {
      regex += `\\${character}`;
      index += 1;
      continue;
    }
    regex += character ?? "";
    index += 1;
  }

  const compiled = hasSlash
    ? new RegExp(`^${regex}$`, "iu")
    : new RegExp(`^(?:.*/)?${regex}$`, "iu");
  if (globRegexCache.size >= maximumCachedGlobs) {
    const oldest = globRegexCache.keys().next().value;
    if (oldest !== undefined) globRegexCache.delete(oldest);
  }
  globRegexCache.set(glob, compiled);
  return compiled;
}

export function matchesPathGlob(path: string, glob: string): boolean {
  const normalizedPath = path.replace(/^\/+|\/+$/gu, "").replace(/\\/gu, "/");
  return globToRegex(glob).test(normalizedPath);
}

export function matchesAnyPathGlob(
  path: string,
  globs: readonly string[],
): boolean {
  return globs.some((glob) => matchesPathGlob(path, glob));
}

export function isUniversalRepositoryPolicyGlob(glob: string): boolean {
  return !/[A-Za-z0-9_-]/u.test(glob.trim());
}

export function repositoryPolicyGlobCanMatchProtectedPath(
  glob: string,
): boolean {
  const normalized = glob.trim().replace(/^\/+|\/+$/gu, "");
  if (
    PROTECTED_POLICY_PATHS.some((path) => matchesPathGlob(path, normalized))
  ) {
    return true;
  }

  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash < 0) return false;
  return matchesPathGlob(".github/workflows", normalized.slice(0, lastSlash));
}
