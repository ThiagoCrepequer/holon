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

function ripgrepMatch(index: number): string {
  return JSON.stringify({
    data: { lines: { text: `match-${index}` } },
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
    if (argv[0] === "rg")
      return Promise.resolve({
        exitCode: 0,
        stderr: "",
        stdout: '{"type":"match"}',
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

  it("checks out exact commits, blocks clone egress and persists a bounded TS/JS context", async () => {
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
    const service = new RepositoryExecutorService({ get: () => sandbox });

    await expect(
      service.runTool(
        request.runId,
        repositoryToolCallSchema.parse({
          arguments: { maxResults: 5, query: "symbol" },
          name: "search_text",
        }),
      ),
    ).resolves.toEqual({ content: '{"type":"match"}', truncated: false });
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
    sandbox.readFile = () => Promise.resolve("x".repeat(100_001));
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
    sandbox.readFile = () => Promise.resolve("😀".repeat(30_000));
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
