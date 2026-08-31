import {
  executorRequestSchema,
  repositoryToolCallSchema,
} from "@holon/contracts";
import { describe, expect, it } from "vitest";

import {
  buildCheckoutPlan,
  buildToolExecution,
  isSupportedSourcePath,
  selectReviewFiles,
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
    ["src/index.ts", true],
    ["src/view.tsx", true],
    ["src/legacy.js", true],
    ["src/view.jsx", true],
    ["package-lock.json", false],
    ["dist/bundle.min.js", false],
    ["generated/client.ts", false],
    ["node_modules/lib/index.js", false],
    ["../escape.ts", false],
    ["src/bad\nname.ts", false],
    ["README.md", false],
  ])("classifies %s as supported=%s", (path, supported) => {
    expect(isSupportedSourcePath(path)).toBe(supported);
  });

  it("deduplicates, sorts and bounds selected files", () => {
    expect(selectReviewFiles(["z.ts", "README.md", "a.ts", "a.ts"], 2)).toEqual(
      ["a.ts", "z.ts"],
    );
    expect(() => selectReviewFiles(["a.ts"], 0)).toThrow();
  });

  it("maps validated tools to fixed executables and argv", () => {
    expect(
      buildToolExecution(
        repositoryToolCallSchema.parse({
          arguments: { maxResults: 20, query: "createUser(" },
          name: "search_text",
        }),
        "/workspace/repository",
      ),
    ).toEqual({
      argv: [
        "rg",
        "--json",
        "--fixed-strings",
        "--max-count",
        "20",
        "--",
        "createUser(",
        ".",
      ],
      cwd: "/workspace/repository",
      maxOutputBytes: 100_000,
    });

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
    expect(
      "argv" in structuralExecution ? structuralExecution.argv : undefined,
    ).toEqual([
      "ast-grep",
      "run",
      "--json=stream",
      "--lang",
      "typescript",
      "--pattern",
      "function $F($$$A) { $$$B }",
      "--",
      ".",
    ]);

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
