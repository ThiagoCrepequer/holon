import { describe, expect, it } from "vitest";

import {
  globToRegex,
  matchesAnyPathGlob,
  matchesPathGlob,
} from "../src/glob-matcher.js";

describe("glob-matcher", () => {
  describe("matchesPathGlob", () => {
    it("matches exact paths without leading slash", () => {
      expect(matchesPathGlob("docs/readme.md", "docs/readme.md")).toBe(true);
      expect(matchesPathGlob("/docs/readme.md", "docs/readme.md")).toBe(true);
      expect(matchesPathGlob("docs/other.md", "docs/readme.md")).toBe(false);
    });

    it("matches single-asterisk wildcards within path segments", () => {
      expect(matchesPathGlob("docs/file.txt", "docs/*.txt")).toBe(true);
      expect(matchesPathGlob("docs/sub/file.txt", "docs/*.txt")).toBe(false);
      expect(matchesPathGlob("file.txt", "*.txt")).toBe(true);
      expect(matchesPathGlob("sub/file.txt", "*.txt")).toBe(true); // glob without slash matches anywhere
    });

    it("matches double-asterisk globstar wildcards across path segments", () => {
      expect(
        matchesPathGlob("docs/sub/deep/file.txt", "docs/**/file.txt"),
      ).toBe(true);
      expect(matchesPathGlob("docs/file.txt", "docs/**/file.txt")).toBe(true);
      expect(matchesPathGlob("generated/a/b/c.js", "generated/**")).toBe(true);
      expect(matchesPathGlob("generated/c.js", "generated/**")).toBe(true);
    });

    it("matches question mark single-character wildcards", () => {
      expect(matchesPathGlob("file1.txt", "file?.txt")).toBe(true);
      expect(matchesPathGlob("fileA.txt", "file?.txt")).toBe(true);
      expect(matchesPathGlob("file12.txt", "file?.txt")).toBe(false);
      expect(matchesPathGlob("file/.txt", "file?.txt")).toBe(false);
    });

    it("handles special regex characters safely without errors", () => {
      expect(matchesPathGlob("path/[test]/file.js", "path/[test]/*.js")).toBe(
        true,
      );
      expect(matchesPathGlob("app$name/v1.0/index.ts", "app$name/**")).toBe(
        true,
      );
      expect(matchesPathGlob("src/(group)/main.go", "src/(group)/*.go")).toBe(
        true,
      );
    });

    it("handles backslashes by normalizing them to forward slashes", () => {
      expect(matchesPathGlob("docs\\sub\\file.txt", "docs/sub/file.txt")).toBe(
        true,
      );
    });

    it("is case-insensitive", () => {
      expect(matchesPathGlob("DOCS/README.MD", "docs/readme.md")).toBe(true);
      expect(matchesPathGlob("Docs/Sub/File.txt", "docs/**/*.txt")).toBe(true);
    });

    it("uses caching for compiled regular expressions", () => {
      const regex1 = globToRegex("cache-test/**/*.ts");
      const regex2 = globToRegex("cache-test/**/*.ts");
      expect(regex1).toBe(regex2);
    });
  });

  describe("matchesAnyPathGlob", () => {
    it("returns false if the glob list is empty", () => {
      expect(matchesAnyPathGlob("any/path.ts", [])).toBe(false);
    });

    it("returns true if any glob matches", () => {
      const globs = ["*.lock", "generated/**", "docs/drafts/*"];
      expect(matchesAnyPathGlob("pnpm-lock.yaml", globs)).toBe(false);
      expect(matchesAnyPathGlob("yarn.lock", globs)).toBe(true);
      expect(matchesAnyPathGlob("generated/proto/bundle.js", globs)).toBe(true);
      expect(matchesAnyPathGlob("docs/drafts/rfc.md", globs)).toBe(true);
      expect(matchesAnyPathGlob("docs/rfc.md", globs)).toBe(false);
    });
  });
});
