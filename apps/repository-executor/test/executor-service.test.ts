import {
  executorRequestSchema,
  repositoryToolCallSchema,
} from "@holon/contracts";
import { describe, expect, it } from "vitest";

import {
  RepositoryExecutorService,
  type SandboxPort,
} from "../src/executor-service.js";

const request = executorRequestSchema.parse({
  baseSha: "b".repeat(40),
  canonicalDiff: [
    "diff --git a/src/index.ts b/src/index.ts",
    "--- a/src/index.ts",
    "+++ b/src/index.ts",
    "@@ -9,0 +10,1 @@",
    "+return null;",
  ].join("\n"),
  cloneUrl: "https://github.com/acme/api.git",
  headSha: "a".repeat(40),
  pullRequestNumber: 7,
  repositoryId: 42,
  runId: `github:42:pr:7:head:${"a".repeat(40)}`,
  schemaVersion: 1,
});

function ripgrepMatch(index: number, path = "src/index.ts"): string {
  return JSON.stringify({
    data: { lines: { text: `match-${index}` }, path: { text: path } },
    type: "match",
  });
}

class FakeSandbox implements SandboxPort {
  public configured?: {
    readonly repositoryPath: string;
    readonly token: string;
  };
  public destroyed = false;
  public egressBlocked = false;
  public readonly commands: string[][] = [];
  public readonly files = new Map<string, string>();
  public readonly readPaths: string[] = [];

  public configureGitHubEgress(
    token: string,
    repositoryPath: string,
  ): Promise<void> {
    this.configured = { repositoryPath, token };
    return Promise.resolve();
  }

  public destroy(): Promise<void> {
    this.destroyed = true;
    return Promise.resolve();
  }

  public exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path));
  }

  public readFile(path: string): Promise<string> {
    this.readPaths.push(path);
    const stored = this.files.get(path);
    if (stored !== undefined) return Promise.resolve(stored);
    return Promise.resolve(
      Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n"),
    );
  }

  public writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    return Promise.resolve();
  }

  public blockGitHubEgress(): Promise<void> {
    this.egressBlocked = true;
    return Promise.resolve();
  }

  public run(
    argv: readonly string[],
    _options?: {
      readonly cwd?: string;
      readonly maxOutputBytes?: number;
      readonly timeoutMs?: number;
    },
  ): Promise<{
    readonly exitCode: number;
    readonly stderr: string;
    readonly stdout: string;
    readonly truncated: boolean;
  }> {
    this.commands.push([...argv]);
    if (argv.includes("rev-parse"))
      return Promise.resolve({
        exitCode: 0,
        stderr: "",
        stdout: `${"a".repeat(40)}\n`,
        truncated: false,
      });
    if (argv.includes("--name-only"))
      return Promise.resolve({
        exitCode: 0,
        stderr: "",
        stdout: "src/index.ts\0README.md\0",
        truncated: false,
      });
    if (argv.includes("--unified=80")) {
      return Promise.resolve({
        exitCode: 0,
        stderr: "",
        stdout: "@@ -9,0 +10,1 @@\n+return null;",
        truncated: false,
      });
    }
    if (argv[0] === "realpath")
      return Promise.resolve({
        exitCode: 0,
        stderr: "",
        stdout: `${argv.at(-1)}\n`,
        truncated: false,
      });
    if (argv[0] === "sed") {
      const range = argv[3]?.match(/^(\d+),(\d+)p$/u);
      if (range === null || range === undefined)
        throw new TypeError("Unexpected sed range in test sandbox");
      const startLine = Number(range[1]);
      const endLine = Number(range[2]);
      const stdout = Array.from(
        { length: endLine - startLine + 1 },
        (_, index) => `line ${startLine + index}`,
      ).join("\n");
      return Promise.resolve({
        exitCode: 0,
        stderr: "",
        stdout: `${stdout}\n`,
        truncated: false,
      });
    }
    if (argv[0] === "rg")
      return Promise.resolve({
        exitCode: 0,
        stderr: "",
        stdout: ripgrepMatch(1),
        truncated: false,
      });
    return Promise.resolve({
      exitCode: 0,
      stderr: "",
      stdout: "",
      truncated: false,
    });
  }
}

describe("RepositoryExecutorService", () => {
  it("reports whether the ephemeral review context still exists", async () => {
    const sandbox = new FakeSandbox();
    const service = new RepositoryExecutorService({ get: () => sandbox });

    await expect(service.hasContext(request.runId)).resolves.toBe(false);
    await service.prepare(request, "installation-token");
    await expect(service.hasContext(request.runId)).resolves.toBe(true);
  });

  it("checks out exact commits, blocks clone egress and persists a bounded structural context", async () => {
    const sandbox = new FakeSandbox();
    const service = new RepositoryExecutorService({ get: () => sandbox });

    await expect(
      service.prepare(request, "installation-token"),
    ).resolves.toMatchObject({
      changedLineCount: 1,
      fileCount: 1,
      runId: request.runId,
      schemaVersion: 1,
      truncated: false,
    });
    await expect(service.loadContext(request.runId)).resolves.toEqual({
      changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
      diff: request.canonicalDiff,
      reviewedFiles: [{ mode: "structural", path: "src/index.ts" }],
      surface: [
        {
          change: "added",
          excerpt: "return null;",
          kind: "control_flow",
          line: 10,
          path: "src/index.ts",
        },
      ],
      truncated: false,
    });
    expect(sandbox.configured).toEqual({
      repositoryPath: "/acme/api.git",
      token: "installation-token",
    });
    expect(sandbox.egressBlocked).toBe(true);
    expect(sandbox.commands.flat()).toContain(
      "http://github.holon.internal/acme/api.git",
    );
    expect(sandbox.commands.flat()).not.toContain(request.cloneUrl);
    expect(
      sandbox.files.get("/workspace/holon-review-context.json"),
    ).toBeDefined();
    expect(sandbox.commands.flat()).not.toContain("npm");
  });

  it("includes safe textual patches while ignoring binary, lock, generated, vendored and minified files", async () => {
    const sandbox = new FakeSandbox();
    const service = new RepositoryExecutorService({ get: () => sandbox });
    const textualRequest = executorRequestSchema.parse({
      ...request,
      canonicalDiff: [
        "diff --git a/README.md b/README.md",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -1 +1,2 @@",
        " # Project",
        "+Document the runtime contract.",
        "diff --git a/package-lock.json b/package-lock.json",
        "--- a/package-lock.json",
        "+++ b/package-lock.json",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "diff --git a/generated/client.py b/generated/client.py",
        "--- a/generated/client.py",
        "+++ b/generated/client.py",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "diff --git a/vendor/library.go b/vendor/library.go",
        "--- a/vendor/library.go",
        "+++ b/vendor/library.go",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "diff --git a/public/app.min.js b/public/app.min.js",
        "--- a/public/app.min.js",
        "+++ b/public/app.min.js",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "diff --git a/assets/logo.png b/assets/logo.png",
        "new file mode 100644",
        "index 0000000..1234567",
        "Binary files /dev/null and b/assets/logo.png differ",
      ].join("\n"),
    });

    await expect(
      service.prepare(textualRequest, "installation-token"),
    ).resolves.toMatchObject({ changedLineCount: 1, fileCount: 1 });
    await expect(service.loadContext(request.runId)).resolves.toMatchObject({
      changedLines: [{ line: 2, path: "README.md", side: "RIGHT" }],
      reviewedFiles: [{ mode: "textual", path: "README.md" }],
      surface: [],
    });
    const context = await service.loadContext(request.runId);
    expect(context.diff).toContain("README.md");
    expect(context.diff).not.toMatch(
      /package-lock|generated\/client|vendor\/library|app\.min|logo\.png/u,
    );
  });

  it("destroys the sandbox immediately when checkout fails permanently", async () => {
    const sandbox = new FakeSandbox();
    sandbox.run = () =>
      Promise.resolve({
        exitCode: 1,
        stderr: "authentication failed",
        stdout: "",
        truncated: false,
      });
    const service = new RepositoryExecutorService({ get: () => sandbox });

    await expect(
      service.prepare(request, "installation-token"),
    ).rejects.toMatchObject({
      name: "RepositoryPermanentError",
      retryable: false,
      stage: "initialize",
    });
    expect(sandbox.destroyed).toBe(true);
    expect(sandbox.egressBlocked).toBe(false);
  });

  it("classifies a terminated checkout as transient and destroys its sandbox", async () => {
    const sandbox = new FakeSandbox();
    sandbox.run = () =>
      Promise.resolve({
        exitCode: 143,
        stderr: "",
        stdout: "",
        truncated: false,
      });
    const service = new RepositoryExecutorService({ get: () => sandbox });

    await expect(
      service.prepare(request, "installation-token"),
    ).rejects.toMatchObject({
      name: "RepositoryTransientError",
      retryable: true,
      stage: "initialize",
    });
    expect(sandbox.destroyed).toBe(true);
  });

  it("classifies sandbox timeouts as transient without leaking their message", async () => {
    const sandbox = new FakeSandbox();
    const timeout = new Error("sensitive upstream details");
    timeout.name = "ProcessWaitTimeoutError";
    sandbox.run = () => Promise.reject(timeout);
    const service = new RepositoryExecutorService({ get: () => sandbox });

    await expect(
      service.prepare(request, "installation-token"),
    ).rejects.toMatchObject({
      message: "HOLON_REPOSITORY_TRANSIENT:initialize:timed-out",
      name: "RepositoryTransientError",
    });
    expect(sandbox.destroyed).toBe(true);
  });

  it("rejects an empty installation token before creating external access", async () => {
    const sandbox = new FakeSandbox();
    const service = new RepositoryExecutorService({ get: () => sandbox });
    await expect(service.prepare(request, "")).rejects.toThrow(
      "installationToken",
    );
    expect(sandbox.configured).toBeUndefined();
  });

  it("runs validated search and bounded line reads in the existing sandbox", async () => {
    const sandbox = new FakeSandbox();
    const originalRun = sandbox.run.bind(sandbox);
    let readOptions: Parameters<SandboxPort["run"]>[1] | undefined;
    sandbox.run = (argv, options) => {
      if (argv[0] === "sed") readOptions = options;
      return originalRun(argv, options);
    };
    const service = new RepositoryExecutorService({ get: () => sandbox });

    await expect(
      service.runTool(
        request.runId,
        repositoryToolCallSchema.parse({
          arguments: { maxResults: 5, query: "symbol" },
          name: "search_text",
        }),
      ),
    ).resolves.toEqual({ content: ripgrepMatch(1), truncated: false });
    await expect(
      service.runTool(
        request.runId,
        repositoryToolCallSchema.parse({
          arguments: { endLine: 12, path: "src/index.ts", startLine: 10 },
          name: "read_file",
        }),
      ),
    ).resolves.toEqual({
      content: "line 10\nline 11\nline 12",
      truncated: false,
    });
    expect(sandbox.readPaths).toEqual([]);
    expect(sandbox.commands).toContainEqual([
      "sed",
      "-n",
      "-e",
      "10,12p",
      "/workspace/repository/src/index.ts",
    ]);
    expect(readOptions).toEqual({
      cwd: "/workspace/repository",
      maxOutputBytes: 100_000,
      timeoutMs: 20_000,
    });
  });

  it("reviews deletion-only patches instead of treating them as an empty scope", async () => {
    const sandbox = new FakeSandbox();
    const service = new RepositoryExecutorService({ get: () => sandbox });
    const deletionRequest = executorRequestSchema.parse({
      ...request,
      canonicalDiff: [
        "diff --git a/src/policy.ts b/src/policy.ts",
        "--- a/src/policy.ts",
        "+++ b/src/policy.ts",
        "@@ -1 +0,0 @@",
        "-assertAuthorized(request);",
      ].join("\n"),
    });

    await expect(
      service.prepare(deletionRequest, "installation-token"),
    ).resolves.toMatchObject({ changedLineCount: 0, fileCount: 1 });
    await expect(service.loadContext(request.runId)).resolves.toMatchObject({
      changedLines: [],
      reviewedFiles: [{ mode: "structural", path: "src/policy.ts" }],
    });
    expect((await service.loadContext(request.runId)).diff).toContain(
      "-assertAuthorized(request);",
    );
  });

  it("reserves early budget for textual context when structural patches are large", async () => {
    const sandbox = new FakeSandbox();
    const service = new RepositoryExecutorService({ get: () => sandbox });
    const largeLine = "x".repeat(58_000);
    const documentationLine = "d".repeat(5_000);
    const mixedRequest = executorRequestSchema.parse({
      ...request,
      canonicalDiff: [
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -0,0 +1 @@",
        `+${largeLine}`,
        "diff --git a/src/b.ts b/src/b.ts",
        "--- a/src/b.ts",
        "+++ b/src/b.ts",
        "@@ -0,0 +1 @@",
        `+${largeLine}`,
        "diff --git a/README.md b/README.md",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -0,0 +1 @@",
        `+${documentationLine}`,
      ].join("\n"),
    });

    await expect(
      service.prepare(mixedRequest, "installation-token"),
    ).resolves.toMatchObject({ fileCount: 2, truncated: true });
    await expect(service.loadContext(request.runId)).resolves.toMatchObject({
      reviewedFiles: [
        { mode: "structural", path: "src/a.ts" },
        { mode: "textual", path: "README.md" },
      ],
    });
  });

  it("enforces review exclusions on tool capabilities and search results", async () => {
    const sandbox = new FakeSandbox();
    const service = new RepositoryExecutorService({ get: () => sandbox });
    sandbox.files.set(
      "/workspace/holon-review-context.json",
      JSON.stringify({
        changedLines: [{ line: 1, path: "README.md", side: "RIGHT" }],
        diff: "+documentation",
        reviewedFiles: [{ mode: "textual", path: "README.md" }],
      }),
    );

    await expect(
      service.runTool(
        request.runId,
        repositoryToolCallSchema.parse({
          arguments: {
            language: "typescript",
            maxResults: 5,
            pattern: "$A",
          },
          name: "search_structure",
        }),
      ),
    ).rejects.toThrow("unavailable without structural review files");
    await expect(
      service.runTool(
        request.runId,
        repositoryToolCallSchema.parse({
          arguments: { path: ".env.production" },
          name: "read_file",
        }),
      ),
    ).rejects.toThrow("excluded from review");

    sandbox.run = () =>
      Promise.resolve({
        exitCode: 0,
        stderr: "",
        stdout: [
          ripgrepMatch(1, "src/index.ts"),
          ripgrepMatch(2, "vendor/library.ts"),
          ripgrepMatch(3, ".env.production"),
        ].join("\n"),
        truncated: false,
      });
    await expect(
      service.runTool(
        request.runId,
        repositoryToolCallSchema.parse({
          arguments: { maxResults: 5, query: "match" },
          name: "search_text",
        }),
      ),
    ).resolves.toEqual({
      content: ripgrepMatch(1, "src/index.ts"),
      truncated: false,
    });
  });

  it("returns only structural paths from ast-grep streaming output", async () => {
    const sandbox = new FakeSandbox();
    const service = new RepositoryExecutorService({ get: () => sandbox });
    sandbox.files.set(
      "/workspace/holon-review-context.json",
      JSON.stringify({
        changedLines: [{ line: 1, path: "src/index.ts", side: "RIGHT" }],
        diff: "+export const value = 1;",
        reviewedFiles: [{ mode: "structural", path: "src/index.ts" }],
      }),
    );
    const allowed = JSON.stringify({ file: "src/index.ts", text: "value" });
    sandbox.run = () =>
      Promise.resolve({
        exitCode: 0,
        stderr: "",
        stdout: [
          allowed,
          JSON.stringify({ file: "README.md", text: "value" }),
          JSON.stringify({ file: "vendor/library.ts", text: "value" }),
        ].join("\n"),
        truncated: false,
      });

    await expect(
      service.runTool(
        request.runId,
        repositoryToolCallSchema.parse({
          arguments: {
            language: "typescript",
            maxResults: 5,
            pattern: "$A",
          },
          name: "search_structure",
        }),
      ),
    ).resolves.toEqual({ content: allowed, truncated: false });
  });

  it("rejects a checkout whose resolved head differs from the signed webhook", async () => {
    const sandbox = new FakeSandbox();
    const original = sandbox.run.bind(sandbox);
    sandbox.run = (argv, options) =>
      argv.includes("rev-parse")
        ? Promise.resolve({
            exitCode: 0,
            stderr: "",
            stdout: `${"c".repeat(40)}\n`,
            truncated: false,
          })
        : original(argv, options);
    const service = new RepositoryExecutorService({ get: () => sandbox });

    await expect(
      service.prepare(request, "installation-token"),
    ).rejects.toMatchObject({
      name: "RepositoryPermanentError",
      stage: "prepare-context",
    });
    expect(sandbox.destroyed).toBe(true);
  });

  it("rejects a repository symlink that resolves outside the checkout", async () => {
    const sandbox = new FakeSandbox();
    const original = sandbox.run.bind(sandbox);
    sandbox.run = (argv, options) =>
      argv[0] === "realpath"
        ? Promise.resolve({
            exitCode: 0,
            stderr: "",
            stdout: "/etc/passwd\n",
            truncated: false,
          })
        : original(argv, options);
    const service = new RepositoryExecutorService({ get: () => sandbox });

    await expect(
      service.runTool(
        request.runId,
        repositoryToolCallSchema.parse({
          arguments: { path: "src/link.ts" },
          name: "read_file",
        }),
      ),
    ).rejects.toThrow("escapes the repository");
  });

  it("rejects an allowed-looking symlink that resolves to an ignored path", async () => {
    const sandbox = new FakeSandbox();
    const original = sandbox.run.bind(sandbox);
    sandbox.run = (argv, options) =>
      argv[0] === "realpath"
        ? Promise.resolve({
            exitCode: 0,
            stderr: "",
            stdout: "/workspace/repository/.env.production\n",
            truncated: false,
          })
        : original(argv, options);
    const service = new RepositoryExecutorService({ get: () => sandbox });

    await expect(
      service.runTool(
        request.runId,
        repositoryToolCallSchema.parse({
          arguments: { path: "src/config.ts" },
          name: "read_file",
        }),
      ),
    ).rejects.toThrow("Resolved repository tool path is excluded");
  });

  it("destroys a sandbox explicitly after the workflow completes", async () => {
    const sandbox = new FakeSandbox();
    const service = new RepositoryExecutorService({ get: () => sandbox });
    await service.cleanup(request.runId);
    expect(sandbox.destroyed).toBe(true);
  });

  it("marks oversized diffs and file reads as truncated", async () => {
    const sandbox = new FakeSandbox();
    const service = new RepositoryExecutorService({ get: () => sandbox });
    const oversizedRequest = executorRequestSchema.parse({
      ...request,
      canonicalDiff: [
        "diff --git a/src/huge.ts b/src/huge.ts",
        "--- a/src/huge.ts",
        "+++ b/src/huge.ts",
        "@@ -0,0 +1,1 @@",
        `+${"x".repeat(60_001)}`,
      ].join("\n"),
    });

    const prepared = await service.prepare(oversizedRequest, "token");
    const context = await service.loadContext(request.runId);
    expect(prepared.truncated).toBe(true);
    expect(prepared.fileCount).toBe(0);
    expect(context.diff).toBe("");
    const originalRun = sandbox.run.bind(sandbox);
    sandbox.run = (argv, options) =>
      argv[0] === "sed"
        ? Promise.resolve({
            exitCode: 0,
            stderr: "",
            stdout: "x".repeat(100_001),
            truncated: true,
          })
        : originalRun(argv, options);
    await expect(
      service.runTool(
        request.runId,
        repositoryToolCallSchema.parse({
          arguments: { path: "src/index.ts" },
          name: "read_file",
        }),
      ),
    ).resolves.toMatchObject({ truncated: true });
  });

  it("bounds file results by UTF-8 bytes rather than UTF-16 characters", async () => {
    const sandbox = new FakeSandbox();
    const originalRun = sandbox.run.bind(sandbox);
    sandbox.run = (argv, options) =>
      argv[0] === "sed"
        ? Promise.resolve({
            exitCode: 0,
            stderr: "",
            stdout: `a${"😀".repeat(30_000)}`,
            truncated: true,
          })
        : originalRun(argv, options);
    const service = new RepositoryExecutorService({ get: () => sandbox });

    const result = await service.runTool(
      request.runId,
      repositoryToolCallSchema.parse({
        arguments: { path: "src/index.ts" },
        name: "read_file",
      }),
    );
    expect(
      new TextEncoder().encode(result.content).byteLength,
    ).toBeLessThanOrEqual(100_000);
    expect(result.truncated).toBe(true);
  });

  it("bounds changed-line coordinate amplification before persisting context", async () => {
    const sandbox = new FakeSandbox();
    const service = new RepositoryExecutorService({ get: () => sandbox });
    const amplifiedRequest = executorRequestSchema.parse({
      ...request,
      canonicalDiff: [
        "diff --git a/src/index.ts b/src/index.ts",
        "--- a/src/index.ts",
        "+++ b/src/index.ts",
        "@@ -0,0 +1,5001 @@",
        Array.from({ length: 5_001 }, () => "+x").join("\n"),
      ].join("\n"),
    });

    await expect(
      service.prepare(amplifiedRequest, "token"),
    ).resolves.toMatchObject({
      changedLineCount: 5_000,
      truncated: true,
    });
    await expect(service.loadContext(request.runId)).resolves.toMatchObject({
      changedLines: expect.arrayContaining([
        { line: 5_000, path: "src/index.ts", side: "RIGHT" },
      ]),
      truncated: true,
    });
  });

  it("trims long-path coordinates to the serialized context byte limit", async () => {
    const sandbox = new FakeSandbox();
    const service = new RepositoryExecutorService({ get: () => sandbox });
    const longPath = `src/${"coordinate".repeat(10)}.ts`;
    const amplifiedRequest = executorRequestSchema.parse({
      ...request,
      canonicalDiff: [
        `diff --git a/${longPath} b/${longPath}`,
        `--- a/${longPath}`,
        `+++ b/${longPath}`,
        "@@ -0,0 +1,5000 @@",
        Array.from({ length: 5_000 }, () => "+x").join("\n"),
      ].join("\n"),
    });

    const prepared = await service.prepare(amplifiedRequest, "token");
    const context = await service.loadContext(request.runId);
    expect(prepared.contextBytes).toBeLessThanOrEqual(500_000);
    expect(prepared.changedLineCount).toBeGreaterThan(0);
    expect(prepared.changedLineCount).toBeLessThan(5_000);
    expect(prepared.truncated).toBe(true);
    expect(context.changedLines).toHaveLength(prepared.changedLineCount);
    expect(context.truncated).toBe(true);
  });

  it("rejects unexpected repository tool exit codes but accepts no-match", async () => {
    const sandbox = new FakeSandbox();
    const service = new RepositoryExecutorService({ get: () => sandbox });
    const call = repositoryToolCallSchema.parse({
      arguments: { maxResults: 5, query: "symbol" },
      name: "search_text",
    });
    sandbox.run = () =>
      Promise.resolve({
        exitCode: 1,
        stderr: "",
        stdout: "",
        truncated: false,
      });
    await expect(service.runTool(request.runId, call)).resolves.toEqual({
      content: "",
      truncated: false,
    });
    sandbox.run = () =>
      Promise.resolve({
        exitCode: 2,
        stderr: "failure",
        stdout: "",
        truncated: false,
      });
    await expect(service.runTool(request.runId, call)).rejects.toThrow(
      "Repository command failed",
    );
  });

  it("enforces a global result and byte bound even when a search command overproduces", async () => {
    const sandbox = new FakeSandbox();
    sandbox.run = () =>
      Promise.resolve({
        exitCode: 0,
        stderr: "",
        stdout: [
          JSON.stringify({ type: "begin" }),
          ripgrepMatch(1),
          ripgrepMatch(2),
          ripgrepMatch(3),
        ].join("\n"),
        truncated: false,
      });
    const service = new RepositoryExecutorService({ get: () => sandbox });

    await expect(
      service.runTool(
        request.runId,
        repositoryToolCallSchema.parse({
          arguments: { maxResults: 2, query: "match" },
          name: "search_text",
        }),
      ),
    ).resolves.toEqual({
      content: `${ripgrepMatch(1)}\n${ripgrepMatch(2)}`,
      truncated: true,
    });
  });
});
