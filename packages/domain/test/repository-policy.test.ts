import { describe, expect, it } from "vitest";

import {
  globToRegex,
  isProtectedPath,
  isUniversalRepositoryPolicyGlob,
  matchesAnyPathGlob,
  matchesPathGlob,
  repositoryPolicyGlobCanMatchProtectedPath,
} from "../src/repository-policy.js";

describe("repository policy path rules", () => {
  it.each([
    ".github/holon.yml",
    "/.HOLON.YAML",
    ".github/workflows/release.yml",
    "SECURITY.md",
    ".github/security.md",
    "CODEOWNERS",
    "docs/CODEOWNERS",
  ])("recognizes protected path %s", (path) => {
    expect(isProtectedPath(path)).toBe(true);
  });

  it("does not protect unrelated source and documentation paths", () => {
    expect(isProtectedPath("src/security.ts")).toBe(false);
    expect(isProtectedPath("docs/architecture.md")).toBe(false);
  });

  it("matches segment, recursive and single-character wildcards", () => {
    expect(matchesPathGlob("src/index.ts", "*.ts")).toBe(true);
    expect(matchesPathGlob("src/deep/index.ts", "src/*.ts")).toBe(false);
    expect(matchesPathGlob("src/deep/index.ts", "src/**")).toBe(true);
    expect(matchesPathGlob("src/index.ts", "src/**/index.ts")).toBe(true);
    expect(matchesPathGlob("file1.ts", "file?.ts")).toBe(true);
    expect(matchesPathGlob("file12.ts", "file?.ts")).toBe(false);
  });

  it("normalizes path separators, slashes and case", () => {
    expect(matchesPathGlob("/Docs\\Guide.MD/", "docs/*.md")).toBe(true);
  });

  it("treats regex punctuation as literal path content", () => {
    expect(
      matchesPathGlob("src/[generated]/file.ts", "src/[generated]/*"),
    ).toBe(true);
    expect(matchesPathGlob("src/generated/file.ts", "src/[generated]/*")).toBe(
      false,
    );
  });

  it("matches any exclusion and handles an empty list", () => {
    expect(
      matchesAnyPathGlob("vendor/pkg/index.js", ["docs/**", "vendor/**"]),
    ).toBe(true);
    expect(matchesAnyPathGlob("src/index.ts", [])).toBe(false);
  });

  it("caches compiled globs and evicts old entries at the bound", () => {
    const first = globToRegex("cache/original/**");
    expect(globToRegex("cache/original/**")).toBe(first);

    for (let index = 0; index < 256; index += 1) {
      globToRegex(`cache/${index}/**`);
    }

    expect(globToRegex("cache/original/**")).not.toBe(first);
  });

  it.each(["*", "**", "****", "*/*", "**/?*", ".**/.?"])(
    "rejects content-free universal glob %s",
    (glob) => {
      expect(isUniversalRepositoryPolicyGlob(glob)).toBe(true);
    },
  );

  it("does not classify bounded named globs as universal", () => {
    expect(isUniversalRepositoryPolicyGlob("generated/**")).toBe(false);
    expect(isUniversalRepositoryPolicyGlob("*.min.js")).toBe(false);
  });

  it.each([
    ".github/**",
    ".github/*.yml",
    "**/CODEOWNERS",
    "SECURITY.?d",
    "docs/**",
  ])("detects glob that can cover protected path %s", (glob) => {
    expect(repositoryPolicyGlobCanMatchProtectedPath(glob)).toBe(true);
  });

  it("detects a glob that covers the protected workflows directory", () => {
    expect(repositoryPolicyGlobCanMatchProtectedPath(".github/*/*.yml")).toBe(
      true,
    );
  });

  it("allows a bounded glob unrelated to protected paths", () => {
    expect(repositoryPolicyGlobCanMatchProtectedPath("generated/**")).toBe(
      false,
    );
    expect(repositoryPolicyGlobCanMatchProtectedPath("*.min.js")).toBe(false);
  });
});
