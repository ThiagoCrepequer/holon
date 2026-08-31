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
      runId: `github:42:pr:7:head:${"a".repeat(40)}`,
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

  it("supports the N-1 identity by asking the broker to resolve the installation", async () => {
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
      repositoryId: 42,
      repositoryName: "api",
      repositoryOwner: "acme",
      repositoryPath: "/acme/api.git",
      runId: `github:42:pr:7:head:${"a".repeat(40)}`,
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
      repositoryId: 42,
      repositoryName: "api",
      repositoryOwner: "acme",
      runId: authorization.runId,
    });
    expect(getInstallationToken.mock.calls[0]?.[0]).not.toHaveProperty(
      "installationId",
    );
    expect(JSON.stringify(getInstallationToken.mock.calls)).not.toContain(
      legacyToken,
    );
  });
});
