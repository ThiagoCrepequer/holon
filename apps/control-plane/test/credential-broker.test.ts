import type { RunId } from "@holon/domain";
import { describe, expect, it, vi } from "vitest";

import {
  createExpectedContainerId,
  issueGitHubCredential,
  parseAppId,
  parseCredentialRequest,
} from "../src/credential-broker.js";

const runId = `github:42:pr:7:head:${"a".repeat(40)}` as RunId;
const request = {
  containerId: `r-16-7-${"a".repeat(40)}`,
  installationId: 99,
  repositoryId: 42,
  repositoryName: "api",
  repositoryOwner: "acme",
  runId,
};

describe("GitHubCredentialBrokerEntrypoint", () => {
  it("strictly validates the serialized run and deterministic container", () => {
    expect(parseCredentialRequest(request)).toEqual(request);
    expect(() =>
      parseCredentialRequest({ ...request, containerId: "untrusted" }),
    ).toThrow("Credential request is invalid");
    expect(() =>
      parseCredentialRequest({ ...request, extra: "not allowed" }),
    ).toThrow("Credential request is invalid");
    expect(() => createExpectedContainerId("not-a-run")).toThrow(
      "Credential request is invalid",
    );
    expect(() =>
      createExpectedContainerId(
        `github:${BigInt(Number.MAX_SAFE_INTEGER) + 1n}:pr:7:head:${"a".repeat(40)}`,
      ),
    ).toThrow("Credential request is invalid");
    expect(() => parseAppId("not-a-number")).toThrow(
      "GITHUB_APP_ID must be a positive integer",
    );
    expect(() => parseAppId("0")).toThrow(
      "GITHUB_APP_ID must be a positive integer",
    );
  });

  it("mints a JIT token only after the per-PR ledger authorizes the exact scope", async () => {
    const createSession = vi.fn(() =>
      Promise.resolve({
        expiresAt: "2026-08-29T13:00:00.000Z",
        token: "jit-installation-token",
      }),
    );
    const getByName = vi.fn(() => ({
      authorizeCredential: () => Promise.resolve(true),
      bootstrapCredentialScope: () => Promise.resolve(false),
      canBootstrapCredentialScope: () => Promise.resolve(false),
    }));
    const credential = await issueGitHubCredential(
      {
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: "private-key",
        GITHUB_APP_SLUG: "holon-reviewer",
        REVIEW_LEDGERS: { getByName },
      },
      request,
      createSession,
    );

    expect(getByName).toHaveBeenCalledWith("github:42:pr:7");
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledWith(expect.any(Object), 99, 42);
    expect(credential).toEqual({
      expiresAt: "2026-08-29T13:00:00.000Z",
      token: "jit-installation-token",
    });
  });

  it("does not mint or reveal details for a stale run", async () => {
    const createSession = vi.fn();
    await expect(
      issueGitHubCredential(
        {
          GITHUB_APP_ID: "123",
          GITHUB_APP_PRIVATE_KEY: "private-key",
          GITHUB_APP_SLUG: "holon-reviewer",
          REVIEW_LEDGERS: {
            getByName: () => ({
              authorizeCredential: () => Promise.resolve(false),
              bootstrapCredentialScope: () => Promise.resolve(false),
              canBootstrapCredentialScope: () => Promise.resolve(false),
            }),
          },
        },
        request,
        createSession,
      ),
    ).rejects.toThrow("Credential request is not authorized");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("resolves and reauthorizes the installation for a draining v1 request", async () => {
    const { installationId: _installationId, ...v1Request } = request;
    const createSession = vi.fn(() =>
      Promise.resolve({
        expiresAt: "2026-08-29T13:00:00.000Z",
        token: "jit-installation-token",
      }),
    );
    const authorizeCredential = vi.fn(() => Promise.resolve(true));
    const resolveInstallation = vi.fn(() => Promise.resolve(99));
    await issueGitHubCredential(
      {
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: "private-key",
        GITHUB_APP_SLUG: "holon-reviewer",
        REVIEW_LEDGERS: {
          getByName: () => ({
            authorizeCredential,
            bootstrapCredentialScope: () => Promise.resolve(false),
            canBootstrapCredentialScope: () => Promise.resolve(false),
          }),
        },
      },
      v1Request,
      createSession,
      resolveInstallation,
    );

    expect(resolveInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 123 }),
      "acme",
      "api",
    );
    expect(authorizeCredential).toHaveBeenLastCalledWith({
      ...request,
      installationId: 99,
    });
    expect(createSession).toHaveBeenCalledWith(expect.any(Object), 99, 42);
  });

  it("bootstraps an absent v1 scope atomically and reuses it on a second call", async () => {
    const { installationId: _installationId, ...v1Request } = request;
    let stored = false;
    const bootstrapCredentialScope = vi.fn(() => {
      stored = true;
      return Promise.resolve(true);
    });
    const ledger = {
      authorizeCredential: vi.fn(() => Promise.resolve(stored)),
      bootstrapCredentialScope,
      canBootstrapCredentialScope: vi.fn(() => Promise.resolve(true)),
    };
    const createSession = vi.fn(() =>
      Promise.resolve({
        expiresAt: "2026-08-29T13:00:00.000Z",
        token: "jit-installation-token",
      }),
    );
    const resolveInstallation = vi.fn(() => Promise.resolve(99));
    const brokerEnv = {
      GITHUB_APP_ID: "123",
      GITHUB_APP_PRIVATE_KEY: "private-key",
      GITHUB_APP_SLUG: "holon-reviewer",
      REVIEW_LEDGERS: { getByName: () => ledger },
    };

    await issueGitHubCredential(
      brokerEnv,
      v1Request,
      createSession,
      resolveInstallation,
    );
    await issueGitHubCredential(
      brokerEnv,
      v1Request,
      createSession,
      resolveInstallation,
    );

    expect(bootstrapCredentialScope).toHaveBeenCalledTimes(1);
    expect(bootstrapCredentialScope).toHaveBeenCalledWith(request);
    expect(createSession).toHaveBeenCalledTimes(2);
    expect(resolveInstallation).toHaveBeenCalledTimes(2);
  });

  it("rejects a conflicting v1 owner before resolving or minting", async () => {
    const { installationId: _installationId, ...v1Request } = request;
    const resolveInstallation = vi.fn();
    const createSession = vi.fn();
    await expect(
      issueGitHubCredential(
        {
          GITHUB_APP_ID: "123",
          GITHUB_APP_PRIVATE_KEY: "private-key",
          GITHUB_APP_SLUG: "holon-reviewer",
          REVIEW_LEDGERS: {
            getByName: () => ({
              authorizeCredential: () => Promise.resolve(false),
              bootstrapCredentialScope: () => Promise.resolve(false),
              canBootstrapCredentialScope: () => Promise.resolve(false),
            }),
          },
        },
        { ...v1Request, repositoryOwner: "other" },
        createSession,
        resolveInstallation,
      ),
    ).rejects.toThrow("Credential request is not authorized");
    expect(resolveInstallation).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("fails closed when the repository is not installed for the App", async () => {
    const { installationId: _installationId, ...v1Request } = request;
    const createSession = vi.fn();
    await expect(
      issueGitHubCredential(
        {
          GITHUB_APP_ID: "123",
          GITHUB_APP_PRIVATE_KEY: "private-key",
          GITHUB_APP_SLUG: "holon-reviewer",
          REVIEW_LEDGERS: {
            getByName: () => ({
              authorizeCredential: () => Promise.resolve(true),
              bootstrapCredentialScope: () => Promise.resolve(false),
              canBootstrapCredentialScope: () => Promise.resolve(false),
            }),
          },
        },
        v1Request,
        createSession,
        () => Promise.reject(new Error("provider detail")),
      ),
    ).rejects.toMatchObject({
      message: "Credential repository is not installed for this GitHub App",
      name: "CredentialRepositoryNotInstalledError",
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("fails closed when an absent v1 scope loses authorization during bootstrap", async () => {
    const { installationId: _installationId, ...v1Request } = request;
    const createSession = vi.fn();
    await expect(
      issueGitHubCredential(
        {
          GITHUB_APP_ID: "123",
          GITHUB_APP_PRIVATE_KEY: "private-key",
          GITHUB_APP_SLUG: "holon-reviewer",
          REVIEW_LEDGERS: {
            getByName: () => ({
              authorizeCredential: () => Promise.resolve(false),
              bootstrapCredentialScope: () => Promise.resolve(false),
              canBootstrapCredentialScope: () => Promise.resolve(true),
            }),
          },
        },
        v1Request,
        createSession,
        () => Promise.resolve(99),
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(createSession).not.toHaveBeenCalled();
  });
});
