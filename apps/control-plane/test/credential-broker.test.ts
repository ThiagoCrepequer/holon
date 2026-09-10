import type { RunId } from "@holon/domain";
import { describe, expect, it, vi } from "vitest";

import {
  issueGitHubCredential,
  parseCredentialRequest,
} from "../src/credential-broker.js";

const runId =
  `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}` as RunId;
const containerId = "f".repeat(64);
const request = {
  containerId,
  installationId: 99,
  repositoryId: 42,
  repositoryName: "api",
  repositoryOwner: "acme",
  runId,
};

describe("GitHubCredentialBrokerEntrypoint", () => {
  it("validates the platform Durable Object ID before ledger authorization", () => {
    expect(parseCredentialRequest(request)).toEqual(request);
    expect(() =>
      parseCredentialRequest({ ...request, extra: "not allowed" }),
    ).toThrow("Credential request is invalid");
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
    }));
    const credential = await issueGitHubCredential(
      {
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY_CURRENT: "private-key",
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
          GITHUB_APP_PRIVATE_KEY_CURRENT: "private-key",
          GITHUB_APP_SLUG: "holon-reviewer",
          REVIEW_LEDGERS: {
            getByName: () => ({
              authorizeCredential: () => Promise.resolve(false),
            }),
          },
        },
        request,
        createSession,
      ),
    ).rejects.toThrow("Credential request is not authorized");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("rejects a credential request without installation identity before minting", async () => {
    const { installationId: _installationId, ...incompleteRequest } = request;
    const authorizeCredential = vi.fn();
    const createSession = vi.fn();
    await expect(
      issueGitHubCredential(
        {
          GITHUB_APP_ID: "123",
          GITHUB_APP_SLUG: "holon-reviewer",
          GITHUB_APP_PRIVATE_KEY_CURRENT: "private-key",
          REVIEW_LEDGERS: { getByName: () => ({ authorizeCredential }) },
        },
        incompleteRequest,
        createSession,
      ),
    ).rejects.toThrow("Credential request is invalid");
    expect(authorizeCredential).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });
});
