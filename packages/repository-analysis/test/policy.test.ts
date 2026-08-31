import {
  executorRequestSchema,
  repositoryToolCallSchema,
} from "@holon/contracts";
import { describe, expect, it } from "vitest";

import {
  buildCheckoutPlan,
  buildToolExecution,
  classifyPullRequestDiffFile,
  classifyReviewPath,
  isReviewablePullRequestDiffFile,
  isReviewablePath,
  selectReviewableFiles,
  splitPullRequestDiff,
  trustedAstGrepConfigPath,
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
        maxOutputBytes: 10_000,
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
        maxOutputBytes: 20_000,
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
        maxOutputBytes: 10_000,
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
    ["schemas/client.generated.json", undefined],
    ["schemas/CLIENT.GENERATED.JSON", undefined],
    ["schemas/client-generated.yaml", undefined],
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
    ["package.resolved", undefined],
    [".terraform.lock.hcl", undefined],
    ["pubspec.lock", undefined],
    ["dependencies/custom.lock", undefined],
    ["bun.lockb", undefined],
    ["gradle.lockfile", undefined],
    ["npm-shrinkwrap.json", undefined],
    ["NPM-SHRINKWRAP.JSON", undefined],
    ["assets/logo.png", undefined],
    ["assets/LOGO.PNG", undefined],
    ["secrets/private.pem", undefined],
    ["secrets/PRIVATE.PEM", undefined],
    [".env.production", undefined],
    [".ENV.PRODUCTION", undefined],
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

  it.each([
    ["renamed", ".env.production", "docs/configuration.txt"],
    ["renamed", "docs/configuration.txt", ".env.production"],
    ["copied", "secrets/private.pem", "src/public-key.txt"],
    ["copied", "src/public-key.txt", "secrets/private.pem"],
  ] as const)(
    "rejects a %s when either side is excluded (%s -> %s)",
    (changeType, oldPath, newPath) => {
      const operation = changeType === "renamed" ? "rename" : "copy";
      const [file] = splitPullRequestDiff(
        [
          `diff --git a/${oldPath} b/${newPath}`,
          "similarity index 100%",
          `${operation} from ${oldPath}`,
          `${operation} to ${newPath}`,
        ].join("\n"),
      );

      if (file === undefined) throw new Error("Expected one parsed diff file");
      expect(file.changeType).toBe(changeType);
      expect(classifyPullRequestDiffFile(file)).toBeUndefined();
      expect(isReviewablePullRequestDiffFile(file)).toBe(false);
    },
  );

  it("classifies a safe rename using its compatible destination path", () => {
    const [file] = splitPullRequestDiff(
      [
        "diff --git a/src/old.ts b/src/new.ts",
        "similarity index 100%",
        "rename from src/old.ts",
        "rename to src/new.ts",
      ].join("\n"),
    );

    expect(file).toBeDefined();
    expect(classifyPullRequestDiffFile(file!)).toBe("structural");
    expect(isReviewablePullRequestDiffFile(file!)).toBe(true);
  });

  it("fails closed when change metadata and the compatible path disagree", () => {
    expect(
      classifyPullRequestDiffFile({
        changeType: "modified",
        newPath: "src/new.ts",
        oldPath: "src/old.ts",
        patch: "",
        path: "src/new.ts",
      }),
    ).toBeUndefined();
    expect(
      classifyPullRequestDiffFile({
        changeType: "added",
        newPath: "src/new.ts",
        oldPath: "src/old.ts",
        patch: "",
        path: "src/new.ts",
      }),
    ).toBeUndefined();
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
      "--config",
      trustedAstGrepConfigPath,
      "--json=stream",
      "--lang",
      "typescript",
    ]);
    expect(trustedAstGrepConfigPath).toBe("/opt/holon/sgconfig.yml");
    expect(structuralArgv).toContain("--pattern");
    expect(structuralArgv).toContain("function $F($$$A) { $$$B }");
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

  it.each([
    [".env.production", "!**/.env.*"],
    ["bun.lockb", "!**/bun.lockb"],
    ["gradle.lockfile", "!**/gradle.lockfile"],
    ["npm-shrinkwrap.json", "!**/npm-shrinkwrap.json"],
    [
      "assets/logo.png",
      "!**/*.{7z,a,ai,apk,avi,avif,bin,bmp,bz2,class,db,der,dll,doc,docx,dylib,ear,eot,exe,gif,gz,ico,iso,jar,jpeg,jpg,jks,keystore,mov,mp3,mp4,o,ogg,otf,p12,pdf,pfx,png,ppt,pptx,psd,pyc,rar,so,sqlite,sqlite2,sqlite3,tar,tiff,tif,tgz,ttf,war,wasm,wav,webm,webp,woff,woff2,xls,xlsx,xz,zip}",
    ],
  ])("derives a search exclusion for classified path %s", (path, glob) => {
    expect(classifyReviewPath(path)).toBeUndefined();
    const execution = buildTool({
      arguments: { maxResults: 5, query: "symbol" },
      name: "search_text",
    });
    expect("argv" in execution ? execution.argv : []).toContain(glob);
  });

  it.each([
    ["schemas/client.generated.json", "!**/*.generated.", "json"],
    ["schemas/client-generated.yaml", "!**/*-generated.", "yaml"],
  ])(
    "derives the generated-file search exclusion for %s",
    (path, prefix, fileExtension) => {
      expect(classifyReviewPath(path)).toBeUndefined();
      const execution = buildTool({
        arguments: { maxResults: 5, query: "symbol" },
        name: "search_text",
      });
      const argv = "argv" in execution ? execution.argv : [];
      expect(
        argv.some(
          (argument) =>
            argument.startsWith(prefix) && argument.includes(fileExtension),
        ),
      ).toBe(true);
    },
  );

  it("excludes secret env files globally while restoring safe templates", () => {
    const execution = buildTool({
      arguments: { maxResults: 5, query: "PLACEHOLDER" },
      name: "search_text",
    });
    const argv = "argv" in execution ? execution.argv : [];

    expect(argv.indexOf("**/*")).toBeLessThan(argv.indexOf("!**/.env.*"));
    expect(argv.indexOf("!**/.env.*")).toBeLessThan(
      argv.indexOf("**/.env.example"),
    );
    expect(argv).toContain("!**/.env");
    expect(argv).toContain("!**/.env.*");
    expect(argv).toContain("**/.env.example");
    expect(argv).toContain("**/.env.sample");
    expect(argv).toContain("**/.env.template");
    expect(argv).toContain("!**/.[eE][nN][vV].*");
    expect(argv).toContain("**/.[eE][nN][vV].[eE][xX][aA][mM][pP][lL][eE]");
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
