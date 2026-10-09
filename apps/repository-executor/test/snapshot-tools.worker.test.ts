import { getSandbox, Sandbox } from "@cloudflare/sandbox";
import {
  createExecutionContext,
  env,
  reset,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";

import {
  CloudflareSandboxPort,
  CloudflareSandboxProvider,
  HolonSandbox,
  RepositoryExecutorEntrypoint,
} from "../src/cloudflare-sandbox.js";
import { createSandboxId } from "../src/sandbox-identity.js";

vi.mock("@cloudflare/sandbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cloudflare/sandbox")>();
  const { DurableObject } = await import("cloudflare:workers");
  // External container lifecycle is controlled; Holon's lease/cache/policy stay real.
  class ControlledSandbox extends DurableObject {
    setKeepAlive() {
      return Promise.resolve();
    }
    async schedule(date: Date, method: string) {
      await this.ctx.storage.put(method, date.getTime());
    }
    deleteSchedules(method: string) {
      void this.ctx.storage.delete(method);
    }
    destroy() {
      return Promise.resolve();
    }
  }
  return { ...actual, Sandbox: ControlledSandbox, getSandbox: vi.fn() };
});
afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});
const runId = `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}`;
const call = {
  name: "read_file",
  arguments: { path: "src/caller.ts", startLine: 1, endLine: 1 },
} as const;

function externalSandbox() {
  const files = new Map([
    [
      "/workspace/holon-review-scope.json",
      JSON.stringify({ deniedPaths: [], additionalExcludes: [] }),
    ],
  ]);
  const commands: string[][] = [];
  const output = {
    exitCode: 0,
    stderr: "",
    stdout: "if (value) return value.id;\n",
    timedOut: false,
    truncated: false,
  };
  const sdk = {
    readFile: vi.fn(async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw new Error("Unexpected file");
      return { content };
    }),
    exists: vi.fn(async () => ({ exists: true })),
    writeFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    setOutboundByHost: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
    exec: vi.fn(async (argv: string[]) => {
      commands.push(argv);
      if (argv[0] !== "realpath" && argv[0] !== "sed")
        throw new Error("Unexpected command");
      return {
        output: async () => ({
          ...output,
          stdout:
            argv[0] === "realpath"
              ? "/workspace/repository/src/caller.ts\n"
              : output.stdout,
        }),
        kill: vi.fn(async () => {}),
      };
    }),
  };
  vi.mocked(getSandbox).mockReturnValue(sdk as never);
  return { sdk, files, commands };
}

it("reauthorizes cache hits, preserves caller-independent work and closes the durable lease", async () => {
  const { sdk, files, commands } = externalSandbox();
  const namespace = (
    env as unknown as { SANDBOXES: DurableObjectNamespace<HolonSandbox> }
  ).SANDBOXES;
  const stub = namespace.getByName(createSandboxId(runId));
  const destroy = vi
    .spyOn(Sandbox.prototype, "destroy")
    .mockResolvedValue(undefined);
  await runInDurableObject(stub, async (instance) => {
    vi.spyOn(instance, "setKeepAlive").mockResolvedValue(undefined);
    const deadline = Date.now() + 10_000;
    await instance.acquireReviewLease(deadline);
    const [first, second] = await Promise.all([
      instance.readReviewTool(runId, call, deadline),
      instance.readReviewTool(runId, call, deadline),
    ]);
    expect(first).toEqual(second);
    expect(commands.filter((argv) => argv[0] === "sed")).toHaveLength(1);
    expect(await instance.getReviewEvidencePack(runId, deadline)).toMatchObject(
      [
        {
          receipt: {
            runId,
            path: "src/caller.ts",
            startLine: 1,
            endLine: 1,
            truncated: false,
          },
          content: "if (value) return value.id;",
        },
      ],
    );
    expect(sdk.readFile.mock.calls.length).toBeGreaterThanOrEqual(3);
    files.set(
      "/workspace/holon-review-scope.json",
      JSON.stringify({
        deniedPaths: ["src/caller.ts"],
        additionalExcludes: [],
      }),
    );
    await expect(
      instance.readReviewTool(runId, call, deadline),
    ).rejects.toThrow();
    expect(commands.filter((argv) => argv[0] === "sed")).toHaveLength(1);
    await instance.closeReviewLease();
    await expect(
      instance.readReviewTool(runId, call, deadline),
    ).rejects.toThrow("lease");
    await instance.expireReviewLease();
  });
  expect(destroy).toHaveBeenCalled();
});

it("translates external SDK commands and bounds their outputs without a tool execution owner", async () => {
  const { sdk } = externalSandbox();
  const provider = new CloudflareSandboxProvider({ SANDBOXES: {} } as never);
  const port = provider.get(runId);
  expect(await port.exists("/workspace/context")).toBe(true);
  await port.writeFile("/workspace/fixture", "fixture");
  expect(await port.readFile("/workspace/fixture")).toBe("fixture");
  await port.configureGitHubEgress({
    runId,
    installationId: 99,
    repositoryId: 42,
    repositoryName: "api",
    repositoryOwner: "acme",
    repositoryPath: "/acme/api.git",
  });
  await port.blockGitHubEgress();
  expect(
    await port.run(["sed", "test"], {
      cwd: "/workspace/repository",
      timeoutMs: 200,
      maxOutputBytes: 32,
    }),
  ).toMatchObject({ stdout: "if (value) return value.id;\n", exitCode: 0 });
  expect(sdk.exec).toHaveBeenCalledWith(["sed", "test"], {
    cwd: "/workspace/repository",
    timeout: 200,
  });
  await port.destroy();
  expect(sdk.destroy).toHaveBeenCalledOnce();
  const failure = new CloudflareSandboxPort({
    exec: async () => ({
      output: async () => {
        throw new Error("private");
      },
      kill: async () => {
        throw new Error("already exited");
      },
    }),
  } as never);
  await expect(failure.run(["sed"])).rejects.toThrow("HOLON_SANDBOX");
});

it("keeps a valid repository read successful when telemetry fails", async () => {
  externalSandbox();
  const namespace = (
    env as unknown as { SANDBOXES: DurableObjectNamespace<HolonSandbox> }
  ).SANDBOXES;
  const stub = namespace.getByName(createSandboxId(runId));
  await runInDurableObject(stub, async (instance) => {
    const deadline = Date.now() + 10_000;
    await instance.acquireReviewLease(deadline);
    const log = vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("Telemetry unavailable");
    });
    try {
      expect(await instance.readReviewTool(runId, call, deadline)).toEqual({
        content: "if (value) return value.id;",
        truncated: false,
      });
    } finally {
      log.mockRestore();
    }
  });
});

it("uses the private RPC entrypoint to join a tool and acquire/close the lease", async () => {
  externalSandbox();
  const sdk = {
    assertReviewLease: vi.fn(async () => {}),
    readReviewTool: vi.fn(async () => ({ content: "guard", truncated: false })),
    acquireReviewLease: vi.fn(async () => {}),
    getReviewEvidencePack: vi.fn(async () => []),
    closeReviewLease: vi.fn(async () => {}),
  };
  vi.mocked(getSandbox).mockReturnValue(sdk as never);
  const rpc = new RepositoryExecutorEntrypoint(
    createExecutionContext(),
    {} as never,
  );
  await rpc.acquireReviewLease(runId, Date.now() + 10_000);
  const operation = rpc.startTool(runId, call, Date.now() + 10_000);
  expect(await operation.result()).toEqual({
    content: "guard",
    truncated: false,
  });
  operation[Symbol.dispose]();
  expect(await rpc.getEvidencePack(runId, Date.now() + 10_000)).toEqual([]);
  await rpc.cleanup(runId);
  expect(sdk.closeReviewLease).toHaveBeenCalledOnce();
});

it("cancels one caller while a peer receives the same owned physical read", async () => {
  const { sdk, commands } = externalSandbox();
  const { RepositoryToolTask } = await import("../src/repository-tool-task.js");
  const { ToolExecution } = await import("../src/tool-execution.js");
  let started!: () => void, release!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  sdk.exec.mockImplementation(async (argv) => {
    commands.push(argv);
    if (argv[0] !== "sed" && argv[0] !== "realpath")
      throw new Error("Unexpected command");
    return {
      output: async () => {
        if (argv[0] === "sed") {
          started();
          await blocked;
        }
        return {
          stdout:
            argv[0] === "sed"
              ? "guard\n"
              : "/workspace/repository/src/caller.ts\n",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          truncated: false,
        };
      },
      kill: vi.fn(async () => {}),
    };
  });
  const namespace = (
    env as unknown as { SANDBOXES: DurableObjectNamespace<HolonSandbox> }
  ).SANDBOXES;
  const stub = namespace.getByName(createSandboxId(runId));
  await runInDurableObject(stub, async (instance) => {
    const deadline = Date.now() + 10_000;
    await instance.acquireReviewLease(deadline);
    const retained: Promise<unknown>[] = [];
    const owner = new ToolExecution(deadline, (work) => {
      retained.push(work);
    });
    const cancelled = new RepositoryToolTask(owner, () =>
      owner.wait(() => instance.readReviewTool(runId, call, deadline)),
    );
    const failed = expect(cancelled.result()).resolves.toMatchObject({
      error: { code: "repository_tool_timeout" },
    });
    await began;
    const peer = instance.readReviewTool(runId, call, deadline);
    await cancelled.cancel();
    await failed;
    release();
    expect(await peer).toEqual({ content: "guard", truncated: false });
    await Promise.all(retained);
    expect(commands.filter((argv) => argv[0] === "sed")).toHaveLength(1);
    await instance.clearReviewToolCache();
    expect(await instance.getReviewEvidencePack(runId, deadline)).toEqual([]);
  });
});
