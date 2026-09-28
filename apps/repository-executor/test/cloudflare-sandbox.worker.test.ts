import {
  ProcessWaitTimeoutError,
  RuntimeIdentityInactiveError,
  StaleProcessHandleError,
} from "@cloudflare/sandbox";
import { describe, expect, it, vi } from "vitest";

import {
  CloudflareSandboxPort,
  HolonSandbox,
  mapSandboxSdkError,
  type GitHubCredentialBroker,
} from "../src/cloudflare-sandbox.js";

describe("Cloudflare Sandbox adapter in workerd", () => {
  const platformContainerId = "f".repeat(64);

  it("maps current exported transient SDK errors without inspecting messages", () => {
    const stale = new StaleProcessHandleError({
      code: "STALE_PROCESS_HANDLE",
      context: { operation: "output", pid: 7, processId: "process-1" },
      httpStatus: 409,
      message: "sensitive stale process details",
      timestamp: "2026-08-30T00:00:00.000Z",
    });
    const timeout = new ProcessWaitTimeoutError({
      code: "PROCESS_WAIT_TIMEOUT",
      context: { operation: "output", processId: "process-1", timeout: 20 },
      httpStatus: 408,
      message: "sensitive timeout details",
      timestamp: "2026-08-30T00:00:00.000Z",
    });

    expect(mapSandboxSdkError(stale)).toMatchObject({
      message: "HOLON_SANDBOX_TRANSIENT:unavailable",
      reason: "unavailable",
      retryable: true,
    });
    expect(mapSandboxSdkError(timeout)).toMatchObject({
      message: "HOLON_SANDBOX_TRANSIENT:timed-out",
      reason: "timed-out",
      retryable: true,
    });
    expect(
      mapSandboxSdkError(new RuntimeIdentityInactiveError()),
    ).toMatchObject({ reason: "unavailable", retryable: true });
  });

  it("requests the credential just in time using the trusted container id", async () => {
    const getInstallationToken = vi.fn<
      GitHubCredentialBroker["getInstallationToken"]
    >(() => Promise.reject(new Error("sensitive broker failure")));
    const authorization = {
      installationId: 99,
      repositoryId: 42,
      repositoryName: "api",
      repositoryOwner: "acme",
      repositoryPath: "/acme/api.git",
      runId: `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}`,
    };

    const handlers = HolonSandbox.outboundHandlers;
    if (handlers === undefined)
      throw new TypeError("Missing outbound handlers");
    const handler = handlers.authenticatedGithub;
    if (handler === undefined) throw new TypeError("Missing outbound handler");
    const response = await handler(
      new Request("http://github.holon.internal/acme/api.git/info/refs"),
      { GITHUB_CREDENTIAL_BROKER: { getInstallationToken } } as never,
      {
        containerId: platformContainerId,
        params: authorization,
      } as never,
    );

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toBe(
      "Credential service unavailable",
    );
    expect(getInstallationToken).toHaveBeenCalledWith({
      containerId: platformContainerId,
      installationId: 99,
      repositoryId: 42,
      repositoryName: "api",
      repositoryOwner: "acme",
      runId: authorization.runId,
    });
  });

  it("returns unavailable when the credential broker fails", async () => {
    const legacyToken = "legacy-installation-token-value";
    const setOutboundCalls: unknown[][] = [];
    const port = new CloudflareSandboxPort({
      setOutboundByHost: (...arguments_: unknown[]) => {
        setOutboundCalls.push(arguments_);
        return Promise.resolve();
      },
    } as never);
    const getInstallationToken = vi.fn<
      GitHubCredentialBroker["getInstallationToken"]
    >(() => Promise.reject(new Error("broker unavailable")));
    const authorization = {
      installationId: 99,
      repositoryId: 42,
      repositoryName: "api",
      repositoryOwner: "acme",
      repositoryPath: "/acme/api.git",
      runId: `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}`,
    };
    await port.configureGitHubEgress(authorization);
    expect(setOutboundCalls).toEqual([
      ["github.holon.internal", "authenticatedGithub", authorization],
    ]);
    expect(JSON.stringify(setOutboundCalls)).not.toContain(legacyToken);
    const persistedOutboundState = {
      containerId: platformContainerId,
      params: setOutboundCalls[0]?.[2],
    };
    expect(JSON.stringify(persistedOutboundState)).not.toContain(legacyToken);
    const handlers = HolonSandbox.outboundHandlers;
    if (handlers === undefined)
      throw new TypeError("Missing outbound handlers");
    const handler = handlers.authenticatedGithub;
    if (handler === undefined) throw new TypeError("Missing outbound handler");

    const response = await handler(
      new Request("http://github.holon.internal/acme/api.git/info/refs"),
      { GITHUB_CREDENTIAL_BROKER: { getInstallationToken } } as never,
      persistedOutboundState as never,
    );

    expect(response.status).toBe(503);
    expect(getInstallationToken).toHaveBeenCalledWith({
      containerId: platformContainerId,
      installationId: 99,
      repositoryId: 42,
      repositoryName: "api",
      repositoryOwner: "acme",
      runId: authorization.runId,
    });
    expect(JSON.stringify(getInstallationToken.mock.calls)).not.toContain(
      legacyToken,
    );
  });
});

import { RepositoryToolTask } from "../src/repository-tool-task.js";
import { ToolExecution } from "../src/tool-execution.js";

it("cancels a running tool process without destroying the shared sandbox", async () => {
  const retained: Promise<unknown>[] = [];
  const execution = new ToolExecution(Date.now() + 10_000, (work) => {
    retained.push(work);
  });
  const kill = vi.fn(async () => {});
  const destroy = vi.fn(async () => {});
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const output = vi.fn(
    ({ signal }: { signal: AbortSignal }) =>
      new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
        started();
      }),
  );
  const port = new CloudflareSandboxPort(
    { exec: async () => ({ output, kill }), destroy } as never,
    execution,
  );
  const task = new RepositoryToolTask(execution, async () => {
    await port.run(["rg", "literal"], { timeoutMs: 20_000 });
    return { content: "", truncated: false };
  });
  const rejected = expect(task.result()).rejects.toMatchObject({
    reason: "timed-out",
  });
  await ready;
  await task.cancel();
  await rejected;
  await Promise.all(retained);
  expect(kill).toHaveBeenCalledOnce();
  expect(destroy).not.toHaveBeenCalled();
});

it("does not start disposed RPC capabilities and executes repeated result reads once", async () => {
  const execute = vi.fn(async () => ({ content: "safe", truncated: false }));
  const cancelled = new RepositoryToolTask(
    new ToolExecution(Date.now() + 10_000, () => {}),
    execute,
  );
  cancelled[Symbol.dispose]();
  await expect(cancelled.result()).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
  const task = new RepositoryToolTask(
    new ToolExecution(Date.now() + 10_000, () => {}),
    execute,
  );
  await Promise.all([task.result(), task.result()]);
  expect(execute).toHaveBeenCalledOnce();
  task[Symbol.dispose]();
});
