import {
  RepositoryPolicyConflictError,
  RepositoryPolicySchemaError,
  RepositoryPolicyScopeError,
  RepositoryPolicySyntaxError,
} from "@holon/domain";
import type { GitHubInstallationSession } from "@holon/github";
import { describe, expect, it } from "vitest";

import {
  computeSha256Hex,
  createDefaultRepositoryPolicy,
  parseAndValidatePolicy,
  resolveRepositoryPolicy,
} from "../src/repository-policy-resolver.js";

const sampleBaseSha = "1111111111111111111111111111111111111111";

describe("repository-policy-resolver", () => {
  describe("computeSha256Hex", () => {
    it("computes standard SHA-256 hex digest for strings and byte arrays", async () => {
      const digestStr = await computeSha256Hex("hello world");
      expect(digestStr).toBe(
        "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
      );
      const bytes = new TextEncoder().encode("hello world");
      const digestBytes = await computeSha256Hex(bytes);
      expect(digestBytes).toBe(digestStr);
    });
  });

  describe("createDefaultRepositoryPolicy", () => {
    it("creates a compliant default policy", async () => {
      const policy = await createDefaultRepositoryPolicy(sampleBaseSha);
      expect(policy).toEqual({
        additionalExcludes: [],
        baseSha: sampleBaseSha,
        effectivePolicyDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        source: "default",
        sourceDigest: null,
        verdictStrictness: "default",
      });
    });
  });

  describe("parseAndValidatePolicy", () => {
    it("parses valid policy with additional_excludes and strictness", async () => {
      const yaml = [
        "review:",
        "  additional_excludes:",
        "    - 'generated/**'",
        "    - '*.min.js'",
        "verdict:",
        "  strictness: block_all_confident_medium",
      ].join("\n");
      const rawBytes = new TextEncoder().encode(yaml);
      const policy = await parseAndValidatePolicy(
        yaml,
        rawBytes,
        ".github/holon.yml",
        sampleBaseSha,
      );

      expect(policy).not.toHaveProperty("version");
      expect(policy.source).toBe(".github/holon.yml");
      expect(policy.baseSha).toBe(sampleBaseSha);
      expect(policy.verdictStrictness).toBe("block_all_confident_medium");
      // Must be sorted lexicographically
      expect(policy.additionalExcludes).toEqual(["*.min.js", "generated/**"]);
      expect(policy.effectivePolicyDigest).toMatch(/^[a-f0-9]{64}$/u);
      expect(policy.sourceDigest).toMatch(/^[a-f0-9]{64}$/u);
    });

    it("defaults verdict strictness to default if omitted", async () => {
      const yaml = ["{}"].join("\n");
      const rawBytes = new TextEncoder().encode(yaml);
      const policy = await parseAndValidatePolicy(
        yaml,
        rawBytes,
        ".holon.yml",
        sampleBaseSha,
      );
      expect(policy.verdictStrictness).toBe("default");
      expect(policy.additionalExcludes).toEqual([]);
    });

    it("rejects invalid YAML syntax with RepositoryPolicySyntaxError", async () => {
      const yaml = "review: [unclosed bracket";
      const rawBytes = new TextEncoder().encode(yaml);
      await expect(
        parseAndValidatePolicy(
          yaml,
          rawBytes,
          ".github/holon.yml",
          sampleBaseSha,
        ),
      ).rejects.toThrow(RepositoryPolicySyntaxError);
    });

    it("rejects YAML aliases and merge keys with RepositoryPolicySyntaxError", async () => {
      const yaml = [
        "base: &base",
        "  version: 1",
        "review:",
        "  <<: *base",
      ].join("\n");
      const rawBytes = new TextEncoder().encode(yaml);
      await expect(
        parseAndValidatePolicy(
          yaml,
          rawBytes,
          ".github/holon.yml",
          sampleBaseSha,
        ),
      ).rejects.toThrow(RepositoryPolicySyntaxError);
    });

    it("rejects standalone YAML anchors before conversion to JavaScript", async () => {
      const yaml = "version: &policyVersion 1";
      await expect(
        parseAndValidatePolicy(
          yaml,
          new TextEncoder().encode(yaml),
          ".github/holon.yml",
          sampleBaseSha,
        ),
      ).rejects.toThrow(RepositoryPolicySyntaxError);
    });

    it("rejects YAML explicit tags with RepositoryPolicySyntaxError", async () => {
      const yaml = ["version: !custom 1"].join("\n");
      const rawBytes = new TextEncoder().encode(yaml);
      await expect(
        parseAndValidatePolicy(
          yaml,
          rawBytes,
          ".github/holon.yml",
          sampleBaseSha,
        ),
      ).rejects.toThrow(RepositoryPolicySyntaxError);
    });

    it("rejects non-mapping YAML roots (scalars, null, arrays) with RepositoryPolicySyntaxError", async () => {
      const inputs = [
        "just a string",
        "42",
        "true",
        "null",
        "---",
        "- item1\n- item2",
      ];
      for (const yaml of inputs) {
        const rawBytes = new TextEncoder().encode(yaml);
        await expect(
          parseAndValidatePolicy(
            yaml,
            rawBytes,
            ".github/holon.yml",
            sampleBaseSha,
          ),
        ).rejects.toThrow(RepositoryPolicySyntaxError);
      }
    });

    it("rejects forbidden keys starting with ! or << in YAML objects with RepositoryPolicySyntaxError", async () => {
      const invalidKeys = ['"!forbidden": 1', '"<<": { "a": 1 }'];
      for (const entry of invalidKeys) {
        const yaml = entry;
        const rawBytes = new TextEncoder().encode(yaml);
        await expect(
          parseAndValidatePolicy(
            yaml,
            rawBytes,
            ".github/holon.yml",
            sampleBaseSha,
          ),
        ).rejects.toThrow(RepositoryPolicySyntaxError);
      }
    });

    it("rejects YAML nesting exceeding safe depth", async () => {
      const yaml =
        "a:\n  b:\n    c:\n      d:\n        e:\n          f:\n            g:\n              h:\n                i:\n                  version: 1";
      const rawBytes = new TextEncoder().encode(yaml);
      await expect(
        parseAndValidatePolicy(
          yaml,
          rawBytes,
          ".github/holon.yml",
          sampleBaseSha,
        ),
      ).rejects.toThrow(RepositoryPolicySyntaxError);
    });

    it("rejects universal exclusions with RepositoryPolicyScopeError", async () => {
      const universalGlobs = ["*", "**", "**/*", "*.*", ".*"];
      for (const glob of universalGlobs) {
        const yaml = [
          "review:",
          "  additional_excludes:",
          `    - '${glob}'`,
        ].join("\n");
        const rawBytes = new TextEncoder().encode(yaml);
        await expect(
          parseAndValidatePolicy(
            yaml,
            rawBytes,
            ".github/holon.yml",
            sampleBaseSha,
          ),
        ).rejects.toThrow(RepositoryPolicyScopeError);
      }
    });

    it("rejects non-relative glob patterns with RepositoryPolicySchemaError", async () => {
      const nonRelativeGlobs = ["/", "/*", "/**", "/**/*"];
      for (const glob of nonRelativeGlobs) {
        const yaml = [
          "review:",
          "  additional_excludes:",
          `    - '${glob}'`,
        ].join("\n");
        const rawBytes = new TextEncoder().encode(yaml);
        await expect(
          parseAndValidatePolicy(
            yaml,
            rawBytes,
            ".github/holon.yml",
            sampleBaseSha,
          ),
        ).rejects.toThrow(RepositoryPolicySchemaError);
      }
    });

    it("rejects attempts to exclude protected files with RepositoryPolicyScopeError", async () => {
      const protectedPaths = [
        ".github/holon.yml",
        ".holon.yml",
        ".github/workflows/test.yml",
        "SECURITY.md",
        ".github/CODEOWNERS",
      ];
      for (const path of protectedPaths) {
        const yaml = [
          "review:",
          "  additional_excludes:",
          `    - '${path}'`,
        ].join("\n");
        const rawBytes = new TextEncoder().encode(yaml);
        await expect(
          parseAndValidatePolicy(
            yaml,
            rawBytes,
            ".github/holon.yml",
            sampleBaseSha,
          ),
        ).rejects.toThrow(RepositoryPolicyScopeError);
      }
    });

    it("rejects directory traversal in globs with RepositoryPolicySchemaError", async () => {
      const yaml = [
        "review:",
        "  additional_excludes:",
        "    - '../secrets.yml'",
      ].join("\n");
      const rawBytes = new TextEncoder().encode(yaml);
      await expect(
        parseAndValidatePolicy(
          yaml,
          rawBytes,
          ".github/holon.yml",
          sampleBaseSha,
        ),
      ).rejects.toThrow(RepositoryPolicySchemaError);
    });

    it("rejects unknown fields with RepositoryPolicySchemaError", async () => {
      const yaml = ["rulesets:", "  - name: extra"].join("\n");
      const rawBytes = new TextEncoder().encode(yaml);
      await expect(
        parseAndValidatePolicy(
          yaml,
          rawBytes,
          ".github/holon.yml",
          sampleBaseSha,
        ),
      ).rejects.toThrow(RepositoryPolicySchemaError);
    });
  });

  describe("resolveRepositoryPolicy", () => {
    const mockSession = (
      files: Record<string, { content: string; rawBytes: Uint8Array }>,
    ): GitHubInstallationSession => {
      return {
        api: {} as unknown as GitHubInstallationSession["api"],
        currentHeadSha: async () => sampleBaseSha,
        currentPullRequestRefs: async () => ({
          baseSha: sampleBaseSha,
          headSha: sampleBaseSha,
        }),
        expectedAuthorLogin: "test-bot",
        expiresAt: "2099-01-01T00:00:00Z",
        pullRequestDiff: async () => "",
        readRepositoryPolicyFile: async (_owner, _repo, _baseSha, path) => {
          return files[path];
        },
        token: "mock-token",
      };
    };

    it("resolves primary policy from .github/holon.yml", async () => {
      const yaml = "review:\n  additional_excludes:\n    - 'generated/**'";
      const session = mockSession({
        ".github/holon.yml": {
          content: yaml,
          rawBytes: new TextEncoder().encode(yaml),
        },
      });

      const policy = await resolveRepositoryPolicy(
        session,
        "owner",
        "repo",
        sampleBaseSha,
      );
      expect(policy.source).toBe(".github/holon.yml");
      expect(policy.additionalExcludes).toEqual(["generated/**"]);
    });

    it("resolves fallback policy from .holon.yml when .github/holon.yml is absent", async () => {
      const yaml = "verdict:\n  strictness: block_all_confident_medium";
      const session = mockSession({
        ".holon.yml": {
          content: yaml,
          rawBytes: new TextEncoder().encode(yaml),
        },
      });

      const policy = await resolveRepositoryPolicy(
        session,
        "owner",
        "repo",
        sampleBaseSha,
      );
      expect(policy.source).toBe(".holon.yml");
      expect(policy.verdictStrictness).toBe("block_all_confident_medium");
    });

    it("throws RepositoryPolicyConflictError when both policy files are present", async () => {
      const yaml1 = "{}";
      const yaml2 = "{}";
      const session = mockSession({
        ".github/holon.yml": {
          content: yaml1,
          rawBytes: new TextEncoder().encode(yaml1),
        },
        ".holon.yml": {
          content: yaml2,
          rawBytes: new TextEncoder().encode(yaml2),
        },
      });

      await expect(
        resolveRepositoryPolicy(session, "owner", "repo", sampleBaseSha),
      ).rejects.toThrow(RepositoryPolicyConflictError);
    });

    it("returns default policy when neither file exists", async () => {
      const session = mockSession({});
      const policy = await resolveRepositoryPolicy(
        session,
        "owner",
        "repo",
        sampleBaseSha,
      );
      expect(policy.source).toBe("default");
      expect(policy.additionalExcludes).toEqual([]);
      expect(policy.sourceDigest).toBeNull();
    });

    it("returns default policy when readRepositoryPolicyFile is undefined on session", async () => {
      const session: GitHubInstallationSession = {
        api: {} as unknown as GitHubInstallationSession["api"],
        currentHeadSha: async () => sampleBaseSha,
        currentPullRequestRefs: async () => ({
          baseSha: sampleBaseSha,
          headSha: sampleBaseSha,
        }),
        expectedAuthorLogin: "test-bot",
        expiresAt: "2099-01-01T00:00:00Z",
        pullRequestDiff: async () => "",
        token: "mock-token",
      };

      const policy = await resolveRepositoryPolicy(
        session,
        "owner",
        "repo",
        sampleBaseSha,
      );
      expect(policy.source).toBe("default");
    });
  });
});
