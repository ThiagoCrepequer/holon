import {
  executorRequestSchema,
  repositoryToolCallSchema,
} from "@holon/contracts";
import { describe, expect, it } from "vitest";

import {
  buildCheckoutPlan,
  buildToolExecution,
  classifyReviewPath,
  isReviewablePath,
  selectReviewableFiles,
} from "../src/index.js";

const request = executorRequestSchema.parse({
  baseSha: "b".repeat(40),
  canonicalDiff: "",
  cloneUrl: "https://github.com/acme/api.git",
  headSha: "a".repeat(40),
  pullRequestNumber: 7,
  repositoryId: 42,
  runId: `github:42:pr:7:head:${"a".repeat(40)}`,
  schemaVersion: 1,
});

function buildTool(call: unknown) {
  return buildToolExecution(
    repositoryToolCallSchema.parse(call),
    "/workspace/repository",
  );
}

describe("repository execution policy", () => {
  it("creates an argv-only exact-SHA checkout plan without credentials or lifecycle scripts", () => {
    const plan = buildCheckoutPlan(request, "/workspace/repository");

    expect(plan).toEqual([
      {
        argv: [
          "git",
          "init",
          "--initial-branch=holon",
          "/workspace/repository",
        ],
        cwd: "/workspace",
        stage: "initialize",
        timeoutMs: 10_000,
      },
      {
        argv: [
          "git",
          "fetch",
          "--no-tags",
          "--depth=1",
          "https://github.com/acme/api.git",
          "a".repeat(40),
          "+refs/pull/7/head:refs/holon/head",
        ],
        cwd: "/workspace/repository",
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
          "a".repeat(40),
        ],
        cwd: "/workspace/repository",
        stage: "checkout",
        timeoutMs: 20_000,
      },
    ]);
    expect(JSON.stringify(plan)).not.toMatch(/token|npm|pnpm|yarn|shell/iu);
  });

  it.each([
    "workspace/repository",
    "/workspace/repository/",
    "/workspace/../repository",
    "/workspace/./repository",
  ])("rejects unsafe workspace path %s", (path) => {
    expect(() => buildCheckoutPlan(request, path)).toThrow();
  });

  it("supports a repository directly below the filesystem root", () => {
    expect(buildCheckoutPlan(request, "/repository")[0]?.cwd).toBe("/");
  });

  it.each([
    ["src/index.ts", "structural"],
    ["src/view.tsx", "structural"],
    ["src/legacy.js", "structural"],
    ["src/view.jsx", "structural"],
    ["README.md", "textual"],
    ["Dockerfile", "textual"],
    ["infra/service.yaml", "textual"],
    ["src/service.py", "textual"],
    [".env.example", "textual"],
    ["config/.env.sample", "textual"],
    ["config/.env.template", "textual"],
    ["package-lock.json", undefined],
    ["pnpm-lock.yaml", undefined],
    ["go.sum", undefined],
    ["dist/bundle.js", undefined],
    ["src/bundle.min.js", undefined],
    ["src/bundle.min.ts", undefined],
    ["src/bundle.min.mts", undefined],
    ["src/bundle.min.cts", undefined],
    ["src/bundle.min.jsx", undefined],
    ["src/bundle.min.tsx", undefined],
    ["generated/client.ts", undefined],
    ["src/__generated__/schema.ts", undefined],
    ["src/client.generated.ts", undefined],
    ["lib/model.g.dart", undefined],
    ["lib/model.freezed.dart", undefined],
    ["docs/how-code-is-generated.md", "textual"],
    ["src/generated-at-runtime.ts", "structural"],
    ["node_modules/lib/index.js", undefined],
    [".git/config", undefined],
    ["third_party/lib/index.js", undefined],
    ["Pods/Library/source.m", undefined],
    [".venv/lib/site.py", undefined],
    ["Podfile.lock", undefined],
    ["Package.resolved", undefined],
    [".terraform.lock.hcl", undefined],
    ["pubspec.lock", undefined],
    ["dependencies/custom.lock", undefined],
    ["assets/logo.png", undefined],
    ["secrets/private.pem", undefined],
    [".env.production", undefined],
    ["../escape.ts", undefined],
    ["src/bad\nname.ts", undefined],
  ])("classifies %s as review mode %s", (path, mode) => {
    expect(classifyReviewPath(path)).toBe(mode);
    expect(isReviewablePath(path)).toBe(mode !== undefined);
  });

  it("deduplicates, sorts and bounds selected files", () => {
    expect(
      selectReviewableFiles(["z.ts", "README.md", "a.ts", "a.ts"], 3),
    ).toEqual(["README.md", "a.ts", "z.ts"]);
    expect(() => selectReviewableFiles(["a.ts"], 0)).toThrow();
  });

  it("maps validated tools to fixed executables and argv", () => {
    const textExecution = buildToolExecution(
      repositoryToolCallSchema.parse({
        arguments: { maxResults: 20, query: "createUser(" },
        name: "search_text",
      }),
      "/workspace/repository",
    );
    expect(textExecution).toMatchObject({
      cwd: "/workspace/repository",
      maxOutputBytes: 100_000,
    });
    const textArgv = "argv" in textExecution ? textExecution.argv : [];
    expect(textArgv.slice(0, 5)).toEqual([
      "rg",
      "--json",
      "--fixed-strings",
      "--max-count",
      "20",
    ]);
    expect(textArgv).toContain("!**/generated/**");
    expect(textArgv).not.toContain("!**/.env*");
    expect(textArgv.slice(-3)).toEqual(["--", "createUser(", "."]);

    const structuralExecution = buildToolExecution(
      repositoryToolCallSchema.parse({
        arguments: {
          language: "typescript",
          maxResults: 10,
          pattern: "function $F($$$A) { $$$B }",
        },
        name: "search_structure",
      }),
      "/workspace/repository",
    );
    const structuralArgv =
      "argv" in structuralExecution ? structuralExecution.argv : [];
    expect(structuralArgv.slice(0, 7)).toEqual([
      "ast-grep",
      "run",
      "--json=stream",
      "--lang",
      "typescript",
      "--pattern",
      "function $F($$$A) { $$$B }",
    ]);
    expect(structuralArgv).toContain("**/*.{ts,mts,cts}");
    expect(structuralArgv).toContain("!**/vendor/**");
    expect(structuralArgv.slice(-2)).toEqual(["--", "."]);

    const scopedSearch = buildToolExecution(
      repositoryToolCallSchema.parse({
        arguments: {
          maxResults: 5,
          paths: ["src/index.ts"],
          query: "createUser(",
        },
        name: "search_text",
      }),
      "/workspace/repository",
    );
    expect("argv" in scopedSearch ? scopedSearch.argv.at(-1) : undefined).toBe(
      "src/index.ts",
    );

    const optionLikePath = buildToolExecution(
      repositoryToolCallSchema.parse({
        arguments: {
          language: "typescript",
          maxResults: 5,
          paths: ["--malicious.ts"],
          pattern: "$A",
        },
        name: "search_structure",
      }),
      "/workspace/repository",
    );
    expect(
      "argv" in optionLikePath ? optionLikePath.argv.slice(-2) : [],
    ).toEqual(["--", "--malicious.ts"]);
  });

  it.each([
    ["javascript", "**/*.{js,mjs,cjs}"],
    ["jsx", "**/*.jsx"],
    ["tsx", "**/*.tsx"],
    ["typescript", "**/*.{ts,mts,cts}"],
  ] as const)(
    "limits %s structural search to its file glob",
    (language, glob) => {
      const execution = buildTool({
        arguments: { language, maxResults: 5, pattern: "$A" },
        name: "search_structure",
      });
      expect("argv" in execution ? execution.argv : []).toContain(glob);
    },
  );

  it.each([
    "!**/*.min.ts",
    "!**/*.min.mts",
    "!**/*.min.cts",
    "!**/*.min.jsx",
    "!**/*.min.tsx",
  ])("excludes minified TypeScript/JSX with search glob %s", (glob) => {
    const execution = buildTool({
      arguments: { maxResults: 5, query: "symbol" },
      name: "search_text",
    });
    expect("argv" in execution ? execution.argv : []).toContain(glob);
  });

  it("denies ignored paths to repository tools and restricts structural search", () => {
    expect(() =>
      buildTool({
        arguments: { path: ".env.production" },
        name: "read_file",
      }),
    ).toThrow("excluded from review");
    expect(() =>
      buildTool({
        arguments: {
          maxResults: 5,
          paths: ["vendor/library.js"],
          query: "symbol",
        },
        name: "search_text",
      }),
    ).toThrow("excluded from review");
    expect(() =>
      buildTool({
        arguments: {
          language: "typescript",
          maxResults: 5,
          paths: ["README.md"],
          pattern: "$A",
        },
        name: "search_structure",
      }),
    ).toThrow("must be JavaScript/TypeScript");
    expect(() =>
      buildTool({ arguments: { path: ".env.example" }, name: "read_file" }),
    ).not.toThrow();
  });

  it.each([".env.example", "config/.env.sample", "config/.env.template"])(
    "allows explicit textual search in safe environment template %s",
    (path) => {
      const execution = buildTool({
        arguments: { maxResults: 5, paths: [path], query: "PLACEHOLDER" },
        name: "search_text",
      });
      expect("argv" in execution ? execution.argv.at(-1) : undefined).toBe(
        path,
      );
    },
  );

  it("represents read_file as a bounded direct file operation, not a command", () => {
    expect(
      buildToolExecution(
        repositoryToolCallSchema.parse({
          arguments: { endLine: 20, path: "src/index.ts", startLine: 10 },
          name: "read_file",
        }),
        "/workspace/repository",
      ),
    ).toEqual({
      endLine: 20,
      kind: "read_file",
      path: "/workspace/repository/src/index.ts",
      startLine: 10,
    });

    expect(
      buildToolExecution(
        repositoryToolCallSchema.parse({
          arguments: { path: "src/index.ts" },
          name: "read_file",
        }),
        "/workspace/repository",
      ),
    ).toMatchObject({ endLine: 200, startLine: 1 });
  });
});
