import {
  executorRequestSchema,
  repositoryToolCallSchema,
  reviewContextSchema,
  type ReviewContext,
} from "@holon/contracts";
import { describe, expect, it, vi } from "vitest";

import type { GitHubEgressAuthorization } from "../src/egress-policy.js";
import {
  RepositoryExecutorService,
  SandboxRuntimeError,
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
  runId: `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}`,
  installationId: 99,
  repositoryName: "api",
  repositoryOwner: "acme",
  effectivePolicy: {
    additionalExcludes: [],
    baseSha: "b".repeat(40),
    effectivePolicyDigest: "c".repeat(64),
    source: "default",
    sourceDigest: null,
    verdictStrictness: "default",
  },
});
const legacyInstallationToken = "installation-token-value";
const defaultCheckoutSource = Array.from(
  { length: 30 },
  (_, index) => `line ${index + 1}`,
).join("\n");

function ripgrepMatch(index: number, path = "src/index.ts"): string {
  return JSON.stringify({
    data: { lines: { text: `match-${index}` }, path: { text: path } },
    type: "match",
  });
}

class FakeSandbox implements SandboxPort {
  public configured?: GitHubEgressAuthorization;
  public destroyed = false;
  public egressBlocked = false;
  public readonly commands: string[][] = [];
  public readonly commandOptions: Array<Parameters<SandboxPort["run"]>[1]> = [];
  public readonly files = new Map<string, string>([
    [
      "/workspace/holon-review-scope.json",
      JSON.stringify({ deniedPaths: [], additionalExcludes: [] }),
    ],
  ]);
  public readonly readPaths: string[] = [];

  public configureGitHubEgress(
    authorization: GitHubEgressAuthorization,
  ): Promise<void> {
    this.configured = authorization;
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
    return Promise.resolve(defaultCheckoutSource);
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
    this.commandOptions.push(_options);
    if (argv.includes("rev-parse"))
      return Promise.resolve({
        exitCode: 0,
        stderr: "",
        stdout: `${"a".repeat(40)}\n`,
        truncated: false,
      });
    if (argv[0] === "git" && argv.includes("ls-tree")) {
      const paths = argv.slice(argv.indexOf("--") + 1);
      return Promise.resolve({
        exitCode: 0,
        stderr: "",
        truncated: false,
        stdout: paths
          .map((path) => {
            const content =
              this.files.get(`/workspace/repository/${path}`) ??
              defaultCheckoutSource;
            return `100644 blob ${"d".repeat(40)} ${new TextEncoder().encode(content).byteLength}\t${path}\0`;
          })
          .join(""),
      });
    }
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

async function loadCurrentContext(
  service: RepositoryExecutorService,
): Promise<ReviewContext> {
  return reviewContextSchema.parse(await service.loadContext(request.runId));
}

describe("RepositoryExecutorService", () => {
  it("passes complete HEAD facade source from preparation to contract analysis", async () => {
    const path = "packages/db/src/tenancy.server.ts";
    const source = [
      "export {",
      "  type TenancyErrorCode,",
      "  TenancyError,",
      '} from "./tenancy-error.server.js";',
    ].join("\n");
    const sandbox = new FakeSandbox();
    sandbox.files.set(`/workspace/repository/${path}`, source);
    const service = new RepositoryExecutorService({ get: () => sandbox });
    await service.prepareRepository({
      ...request,
      canonicalDiff: [
        `diff --git a/${path} b/${path}`,
        `--- a/${path}`,
        `+++ b/${path}`,
        "@@ -1,2 +1,4 @@",
        "-export class TenancyError extends Error {}",
        '-export type TenancyErrorCode = "NOT_FOUND";',
        ...source.split("\n").map((line) => `+${line}`),
      ].join("\n"),
    });
    const context = await loadCurrentContext(service);
    expect(context.structuralImpact?.changedSymbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "TenancyError",
          change: "deleted",
          kind: "class",
        }),
        expect.objectContaining({
          name: "TenancyErrorCode",
          change: "deleted",
          kind: "type",
        }),
      ]),
    );
    expect(context.structuralImpact?.contractBreaks).toEqual([]);
    expect(context.structuralImpact?.repositoryScanTruncated).toBe(false);
    expect(sandbox.readPaths).toContain(`/workspace/repository/${path}`);
  });

  it("reports whether the ephemeral review context still exists", async () => {
    const sandbox = new FakeSandbox();
    const service = new RepositoryExecutorService({ get: () => sandbox });

    expect(
      Object.getOwnPropertyNames(Object.getPrototypeOf(service)).some((name) =>
        /V\d/u.test(name),
      ),
    ).toBe(false);
    await expect(
      service.prepareRepository({
        ...request,
        effectivePolicy: undefined,
      }),
    ).rejects.toThrow();
    expect(sandbox.configured).toBeUndefined();
    await expect(service.hasContext(request.runId)).resolves.toBe(false);
    await service.prepareRepository(request);
    await expect(service.hasContext(request.runId)).resolves.toBe(true);
  });

  it("checks out exact commits, blocks clone egress and persists a bounded structural context", async () => {
    const sandbox = new FakeSandbox();
    const service = new RepositoryExecutorService({ get: () => sandbox });
    const consoleSpies = (
      ["debug", "error", "info", "log", "warn"] as const
    ).map((method) => vi.spyOn(console, method).mockImplementation(() => {}));

    await expect(service.prepareRepository(request)).resolves.toMatchObject({
      changedLineCount: 1,
      fileCount: 1,
      runId: request.runId,
      truncated: false,
    });
    await expect(service.loadContext(request.runId)).resolves.toMatchObject({
      changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
      files: [
        {
          mode: "structural",
          patch: request.canonicalDiff,
          path: "src/index.ts",
        },
      ],
      structuralImpact: {
        changedSymbols: [],
        contractBreaks: [],
        downstreamReferences: [],
        repositoryScanTruncated: false,
        securitySurfaces: [],
        totalDownstreamReferencesCount: 0,
      },
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
      installationId: 99,
      repositoryId: 42,
      repositoryName: "api",
      repositoryOwner: "acme",
      repositoryPath: "/acme/api.git",
      runId: request.runId,
    });
    expect(sandbox.configured).not.toHaveProperty("token");
    expect(
      JSON.stringify({
        commands: sandbox.commands,
        configured: sandbox.configured,
        files: [...sandbox.files.entries()],
        logs: consoleSpies.flatMap((spy) => spy.mock.calls),
      }),
    ).not.toContain(legacyInstallationToken);
    expect(sandbox.egressBlocked).toBe(true);
    expect(sandbox.commands.flat()).toContain(
      "http://github.holon.internal/acme/api.git",
    );
    expect(sandbox.commands.flat()).not.toContain(request.cloneUrl);
    expect(
      sandbox.files.get("/workspace/holon-review-context.json"),
    ).toBeDefined();
    expect(sandbox.commands.flat()).not.toContain("npm");
    expect(sandbox.commandOptions.slice(0, 3)).toEqual([
      {
        cwd: "/workspace",
        maxOutputBytes: 10_000,
        timeoutMs: 10_000,
      },
      {
        cwd: "/workspace/repository",
        maxOutputBytes: 20_000,
        timeoutMs: 60_000,
      },
      {
        cwd: "/workspace/repository",
        maxOutputBytes: 10_000,
        timeoutMs: 20_000,
      },
    ]);
  });

  it("prepares and loads the current context without a credential argument", async () => {
    const sandbox = new FakeSandbox();
    const service = new RepositoryExecutorService({ get: () => sandbox });
    const currentRequest = executorRequestSchema.parse({
      ...request,
      installationId: 99,
      repositoryName: "api",
      repositoryOwner: "acme",
    });

    await expect(
      service.prepareRepository(currentRequest),
    ).resolves.toMatchObject({
      fileCount: 1,
    });
    await expect(service.loadContext(request.runId)).resolves.toMatchObject({
      changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
      files: [
        {
          mode: "structural",
          patch: request.canonicalDiff,
          path: "src/index.ts",
        },
      ],
      truncated: false,
    });
    expect(sandbox.configured).toMatchObject({
      installationId: 99,
      repositoryId: 42,
      repositoryName: "api",
      repositoryOwner: "acme",
    });
  });

  it("prepares repository and loads context under the current contract with policy enforcement", async () => {
    const sandbox = new FakeSandbox();
    const service = new RepositoryExecutorService({ get: () => sandbox });
    const policy = {
      additionalExcludes: ["vendor/**"],
      baseSha: "b".repeat(40),
      effectivePolicyDigest: "c".repeat(64),
      source: ".github/holon.yml" as const,
      sourceDigest: "d".repeat(64),
      verdictStrictness: "block_all_confident_medium" as const,
    };
    const canonicalDiff = [
      "diff --git a/src/index.ts b/src/index.ts",
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -1 +1 @@",
      "-export function changed() { return 1; }",
      "+export function changed() { return 2; }",
    ].join("\n");
    const policyRequest = executorRequestSchema.parse({
      ...request,
      canonicalDiff,
      effectivePolicy: policy,
      installationId: 99,
      repositoryName: "api",
      repositoryOwner: "acme",
    });

    await expect(
      service.prepareRepository(policyRequest),
    ).resolves.toMatchObject({
      effectivePolicyDigest: "c".repeat(64),
      fileCount: 1,
      waiversCount: 0,
    });
    await expect(service.loadContext(request.runId)).resolves.toMatchObject({
      changedLines: [{ line: 1, path: "src/index.ts", side: "RIGHT" }],
      effectivePolicyDigest: "c".repeat(64),
      files: [
        {
          mode: "structural",
          patch: canonicalDiff,
          path: "src/index.ts",
        },
      ],
      policySource: ".github/holon.yml",
      verdictStrictness: "block_all_confident_medium",
      waiversCount: 0,
    });
    expect(sandbox.commands).toContainEqual(
      expect.arrayContaining(["--glob", "!vendor/**"]),
    );
  });

  it("omits sensitive renames and denies their safe-looking destination for the run", async () => {
    const sandbox = new FakeSandbox();
    const service = new RepositoryExecutorService({ get: () => sandbox });
    const currentRequest = executorRequestSchema.parse({
      ...request,
      canonicalDiff: [
        "diff --git a/.env.production b/config.txt",
        "similarity index 50%",
        "rename from .env.production",
        "rename to config.txt",
        "--- a/.env.production",
        "+++ b/config.txt",
        "@@ -1 +1 @@",
        "-DATABASE_PASSWORD=super-secret",
        "+DATABASE_PASSWORD=rotated-secret",
      ].join("\n"),
      installationId: 99,
      repositoryName: "api",
      repositoryOwner: "acme",
    });

    await expect(
      service.prepareRepository(currentRequest),
    ).resolves.toMatchObject({
      fileCount: 0,
    });
    const context = await service.loadContext(request.runId);
    expect(context.files).toEqual([]);
    expect(JSON.stringify(context)).not.toMatch(
      /\.env\.production|super-secret|rotated-secret/u,
    );
    const policy = sandbox.files.get("/workspace/holon-review-scope.json");
    expect(policy).toBe(
      '{"additionalExcludes":[],"deniedPaths":["config.txt"]}',
    );
    expect(policy).not.toMatch(/\.env\.production|secret/u);

    await expect(
      service.runTool(
        request.runId,
        repositoryToolCallSchema.parse({
          arguments: { path: "config.txt" },
          name: "read_file",
        }),
      ),
    ).rejects.toThrow("path_denied");

    const originalRun = sandbox.run.bind(sandbox);
    let searchArgv: readonly string[] | undefined;
    sandbox.run = (argv, options) => {
      if (argv[0] === "rg") {
        searchArgv = argv;
        return Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout: [
            ripgrepMatch(1, "config.txt"),
            ripgrepMatch(2, "src/index.ts"),
          ].join("\n"),
          truncated: false,
        });
      }
      return originalRun(argv, options);
    };
    await expect(
      service.runTool(
        request.runId,
        repositoryToolCallSchema.parse({
          arguments: { maxResults: 5, query: "DATABASE_PASSWORD" },
          name: "search_text",
        }),
      ),
    ).resolves.toEqual({
      content: ripgrepMatch(2, "src/index.ts"),
      truncated: false,
    });
    expect(searchArgv).toContain("!config.txt");
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
      service.prepareRepository(textualRequest),
    ).resolves.toMatchObject({ changedLineCount: 1, fileCount: 1 });
    await expect(service.loadContext(request.runId)).resolves.toMatchObject({
      changedLines: [{ line: 2, path: "README.md", side: "RIGHT" }],
      surface: [],
    });
    const context = await loadCurrentContext(service);
    expect(context.files.map((file) => file.patch).join("\n")).toContain(
      "README.md",
    );
    expect(context.files.map((file) => file.patch).join("\n")).not.toMatch(
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

    await expect(service.prepareRepository(request)).rejects.toMatchObject({
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

    await expect(service.prepareRepository(request)).rejects.toMatchObject({
      name: "RepositoryTransientError",
      retryable: true,
      stage: "initialize",
    });
    expect(sandbox.destroyed).toBe(true);
  });

  it("retries a fetch rejected by a transient GitHub or broker response", async () => {
    const sandbox = new FakeSandbox();
    const originalRun = sandbox.run.bind(sandbox);
    sandbox.run = (argv, options) =>
      argv.includes("fetch")
        ? Promise.resolve({
            exitCode: 128,
            stderr: "The requested URL returned error: 503",
            stdout: "",
            truncated: false,
          })
        : originalRun(argv, options);
    const service = new RepositoryExecutorService({ get: () => sandbox });

    await expect(service.prepareRepository(request)).rejects.toMatchObject({
      name: "RepositoryTransientError",
      retryable: true,
      stage: "fetch",
    });
  });

  it("retries a fetch rejected by a GitHub ref propagation delay (404 / couldn't find remote ref)", async () => {
    const sandbox = new FakeSandbox();
    const originalRun = sandbox.run.bind(sandbox);
    sandbox.run = (argv, options) =>
      argv.includes("fetch")
        ? Promise.resolve({
            exitCode: 128,
            stderr: "fatal: couldn't find remote ref refs/pull/46/head",
            stdout: "",
            truncated: false,
          })
        : originalRun(argv, options);
    const service = new RepositoryExecutorService({ get: () => sandbox });

    await expect(service.prepareRepository(request)).rejects.toMatchObject({
      name: "RepositoryTransientError",
      retryable: true,
      stage: "fetch",
    });
    expect(sandbox.destroyed).toBe(true);
  });

  it("retries a fetch rejected by a GitHub 404 repository/ref delay", async () => {
    const sandbox = new FakeSandbox();
    const originalRun = sandbox.run.bind(sandbox);
    sandbox.run = (argv, options) =>
      argv.includes("fetch")
        ? Promise.resolve({
            exitCode: 128,
            stderr: "The requested URL returned error: 404",
            stdout: "",
            truncated: false,
          })
        : originalRun(argv, options);
    const service = new RepositoryExecutorService({ get: () => sandbox });

    await expect(service.prepareRepository(request)).rejects.toMatchObject({
      name: "RepositoryTransientError",
      retryable: true,
      stage: "fetch",
    });
    expect(sandbox.destroyed).toBe(true);
  });

  it("does not retry a permanent GitHub authentication failure", async () => {
    const sandbox = new FakeSandbox();
    const originalRun = sandbox.run.bind(sandbox);
    sandbox.run = (argv, options) =>
      argv.includes("fetch")
        ? Promise.resolve({
            exitCode: 128,
            stderr: "The requested URL returned error: 401",
            stdout: "",
            truncated: false,
          })
        : originalRun(argv, options);
    const service = new RepositoryExecutorService({ get: () => sandbox });

    await expect(service.prepareRepository(request)).rejects.toMatchObject({
      name: "RepositoryPermanentError",
      retryable: false,
      stage: "fetch",
    });
    expect(sandbox.destroyed).toBe(true);
  });

  it("classifies mapped sandbox timeouts as transient without leaking details", async () => {
    const sandbox = new FakeSandbox();
    sandbox.run = () =>
      Promise.reject(new SandboxRuntimeError(true, "timed-out"));
    const service = new RepositoryExecutorService({ get: () => sandbox });

    await expect(service.prepareRepository(request)).rejects.toMatchObject({
      message: "HOLON_REPOSITORY_TRANSIENT:initialize:timed-out",
      name: "RepositoryTransientError",
    });
    expect(sandbox.destroyed).toBe(true);
  });

  it("preserves an output timeout even when the process exposes an exit code", async () => {
    const sandbox = new FakeSandbox();
    sandbox.run = () =>
      Promise.resolve({
        exitCode: 137,
        stderr: "",
        stdout: "",
        timedOut: true,
        truncated: false,
      });
    const service = new RepositoryExecutorService({ get: () => sandbox });

    await expect(service.prepareRepository(request)).rejects.toMatchObject({
      message: "HOLON_REPOSITORY_TRANSIENT:initialize:timed-out",
      name: "RepositoryTransientError",
      retryable: true,
    });
    expect(sandbox.destroyed).toBe(true);
  });

  it("rejects an invalid installation identity before creating external access", async () => {
    const sandbox = new FakeSandbox();
    const service = new RepositoryExecutorService({ get: () => sandbox });
    await expect(
      service.prepareRepository({ ...request, installationId: 0 }),
    ).rejects.toThrow("installationId");
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
    expect(sandbox.readPaths).not.toContain(
      "/workspace/repository/src/index.ts",
    );
    expect(
      sandbox.readPaths.every(
        (path) => path === "/workspace/holon-review-scope.json",
      ),
    ).toBe(true);
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
      service.prepareRepository(deletionRequest),
    ).resolves.toMatchObject({ changedLineCount: 0, fileCount: 1 });
    await expect(service.loadContext(request.runId)).resolves.toMatchObject({
      changedLines: [],
    });
    expect(
      (await loadCurrentContext(service)).files
        .map((file) => file.patch)
        .join("\n"),
    ).toContain("-assertAuthorized(request);");
  });

  it("keeps structural and textual patches when the complete plan fits across shards", async () => {
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
      service.prepareRepository(mixedRequest),
    ).resolves.toMatchObject({ fileCount: 3, truncated: false });
    const context = await loadCurrentContext(service);
    expect(context.files.map((file) => file.patch).join("\n")).toContain(
      "src/a.ts",
    );
    expect(context.files.map((file) => file.patch).join("\n")).toContain(
      "README.md",
    );
    expect(context.files.map((file) => file.patch).join("\n")).toContain(
      "src/b.ts",
    );
  });

  it("enforces review exclusions on tool capabilities and search results", async () => {
    const sandbox = new FakeSandbox();
    const service = new RepositoryExecutorService({ get: () => sandbox });
    sandbox.files.set(
      "/workspace/holon-review-context.json",
      JSON.stringify({
        effectivePolicyDigest: "c".repeat(64),
        policySource: "default",
        sourceDigest: null,
        verdictStrictness: "default",
        waiversCount: 0,
        truncated: false,
        changedLines: [{ line: 1, path: "README.md", side: "RIGHT" }],
        files: [
          {
            path: "README.md",
            mode: "textual",
            patch: [
              "diff --git a/README.md b/README.md",
              "--- a/README.md",
              "+++ b/README.md",
              "@@ -0,0 +1 @@",
              "+documentation",
            ].join("\n"),
          },
        ],
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
    ).rejects.toThrow("query_unsupported");
    await expect(
      service.runTool(
        request.runId,
        repositoryToolCallSchema.parse({
          arguments: { path: ".env.production" },
          name: "read_file",
        }),
      ),
    ).rejects.toMatchObject({
      name: "RepositoryQueryError",
      code: "path_denied",
    });

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
        effectivePolicyDigest: "c".repeat(64),
        policySource: "default",
        sourceDigest: null,
        verdictStrictness: "default",
        waiversCount: 0,
        truncated: false,
        changedLines: [{ line: 1, path: "src/index.ts", side: "RIGHT" }],
        files: [
          {
            path: "src/index.ts",
            mode: "structural",
            patch: [
              "diff --git a/src/index.ts b/src/index.ts",
              "--- a/src/index.ts",
              "+++ b/src/index.ts",
              "@@ -0,0 +1 @@",
              "+export const value = 1;",
            ].join("\n"),
          },
        ],
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

    await expect(service.prepareRepository(request)).rejects.toMatchObject({
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
    ).rejects.toThrow("path_denied");
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
    ).rejects.toThrow("path_denied");
  });

  it("destroys a sandbox explicitly after the workflow completes", async () => {
    const sandbox = new FakeSandbox();
    const service = new RepositoryExecutorService({ get: () => sandbox });
    await service.cleanup(request.runId);
    expect(sandbox.destroyed).toBe(true);
  });

  it("preserves oversized canonical patches for planning while bounding file reads", async () => {
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

    const prepared = await service.prepareRepository(oversizedRequest);
    const context = await loadCurrentContext(service);
    expect(prepared.truncated).toBe(false);
    expect(prepared.fileCount).toBe(1);
    expect(context.files[0]?.patch).toBe(oversizedRequest.canonicalDiff);
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
        "@@ -0,0 +1,32001 @@",
        Array.from({ length: 32_001 }, () => "+x").join("\n"),
      ].join("\n"),
    });

    await expect(
      service.prepareRepository(amplifiedRequest),
    ).resolves.toMatchObject({
      changedLineCount: 32_000,
      truncated: true,
    });
    await expect(service.loadContext(request.runId)).resolves.toMatchObject({
      changedLines: expect.arrayContaining([
        { line: 32_000, path: "src/index.ts", side: "RIGHT" },
      ]),
      truncated: true,
    });
  }, 20_000);

  it("trims long-path coordinates to the serialized context byte limit", async () => {
    const sandbox = new FakeSandbox();
    const service = new RepositoryExecutorService({ get: () => sandbox });
    const longPath = `src/${"coordinate".repeat(30)}.ts`;
    const amplifiedRequest = executorRequestSchema.parse({
      ...request,
      canonicalDiff: [
        `diff --git a/${longPath} b/${longPath}`,
        `--- a/${longPath}`,
        `+++ b/${longPath}`,
        "@@ -0,0 +1,32000 @@",
        Array.from({ length: 32_000 }, () => "+x").join("\n"),
      ].join("\n"),
    });

    const prepared = await service.prepareRepository(amplifiedRequest);
    const context = await service.loadContext(request.runId);
    expect(prepared.contextBytes).toBeLessThanOrEqual(8_000_000);
    expect(prepared.changedLineCount).toBeGreaterThan(0);
    expect(prepared.changedLineCount).toBeLessThan(32_000);
    expect(prepared.truncated).toBe(true);
    expect(context.changedLines).toHaveLength(prepared.changedLineCount);
    expect(context.truncated).toBe(true);
  }, 20_000);

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

  it("does not treat timed-out tool output as a successful partial result", async () => {
    const sandbox = new FakeSandbox();
    sandbox.run = (argv) =>
      argv[0] === "rg"
        ? Promise.resolve({
            exitCode: 0,
            stderr: "",
            stdout: ripgrepMatch(1),
            timedOut: true,
            truncated: true,
          })
        : FakeSandbox.prototype.run.call(sandbox, argv);
    const service = new RepositoryExecutorService({ get: () => sandbox });

    await expect(
      service.runTool(
        request.runId,
        repositoryToolCallSchema.parse({
          arguments: { maxResults: 5, query: "symbol" },
          name: "search_text",
        }),
      ),
    ).rejects.toMatchObject({
      message: "HOLON_SANDBOX_TRANSIENT:timed-out",
      retryable: true,
    });
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

it("classifies a missing query path while preserving context failures as infrastructure", async () => {
  const sandbox = new FakeSandbox();
  const original = sandbox.run.bind(sandbox);
  sandbox.run = (argv, options) =>
    argv[0] === "realpath" && argv.includes("--canonicalize-existing")
      ? Promise.resolve({
          exitCode: 1,
          stdout: "",
          stderr: "private path",
          truncated: false,
        })
      : original(argv, options);
  const service = new RepositoryExecutorService({ get: () => sandbox });
  await expect(
    service.runTool(
      request.runId,
      repositoryToolCallSchema.parse({
        name: "read_file",
        arguments: { path: "src/missing.ts" },
      }),
    ),
  ).rejects.toMatchObject({
    name: "RepositoryQueryError",
    code: "path_unavailable",
  });
  const failure = new SandboxRuntimeError(true, "unavailable");
  sandbox.readFile = async () => {
    throw failure;
  };
  await expect(
    service.runTool(
      request.runId,
      repositoryToolCallSchema.parse({
        name: "read_file",
        arguments: { path: "src/index.ts" },
      }),
    ),
  ).rejects.toBe(failure);
});
