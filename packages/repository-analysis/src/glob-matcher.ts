const globRegexCache = new Map<string, RegExp>();

export function globToRegex(glob: string): RegExp {
  const cached = globRegexCache.get(glob);
  if (cached !== undefined) return cached;

  const normalized = glob.replace(/^\/+/u, "");
  const hasSlash = normalized.includes("/");

  let regexStr = "";
  let index = 0;
  while (index < normalized.length) {
    const char = normalized[index];
    if (char === "*") {
      if (normalized[index + 1] === "*") {
        if (normalized[index + 2] === "/") {
          // **/
          regexStr += "(?:.*/)?";
          index += 3;
          continue;
        }
        regexStr += ".*";
        index += 2;
        continue;
      }
      regexStr += "[^/]*";
      index += 1;
      continue;
    }
    if (char === "?") {
      regexStr += "[^/]";
      index += 1;
      continue;
    }
    if (
      char === "." ||
      char === "+" ||
      char === "(" ||
      char === ")" ||
      char === "$" ||
      char === "^" ||
      char === "[" ||
      char === "]" ||
      char === "{" ||
      char === "}" ||
      char === "|"
    ) {
      regexStr += `\\${char}`;
      index += 1;
      continue;
    }
    regexStr += char;
    index += 1;
  }

  const compiled = hasSlash
    ? new RegExp(`^${regexStr}$`, "iu")
    : new RegExp(`^(?:.*/)?${regexStr}$`, "iu");

  globRegexCache.set(glob, compiled);
  return compiled;
}

export function matchesPathGlob(path: string, glob: string): boolean {
  const normalizedPath = path.replace(/^\/+/u, "").replace(/\\/gu, "/");
  return globToRegex(glob).test(normalizedPath);
}

export function matchesAnyPathGlob(
  path: string,
  globs: readonly string[],
): boolean {
  if (globs.length === 0) return false;
  const normalizedPath = path.replace(/^\/+/u, "").replace(/\\/gu, "/");
  return globs.some((glob) => globToRegex(glob).test(normalizedPath));
}
