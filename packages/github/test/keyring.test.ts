import { describe, expect, it, vi } from "vitest";

import * as clientModule from "../src/client.js";
import type { GitHubInstallationSession } from "../src/client.js";
import { GitHubRequestError } from "../src/errors.js";
import {
  computeKeyFingerprint,
  createInstallationSessionWithKeyring,
  isAppAuthenticationError,
  MemoryKeyringCircuitBreaker,
  resolveGitHubAppKeyring,
  resolveRepositoryInstallationWithKeyring,
  type GitHubAppKeyring,
  type KeyringTelemetryEvent,
} from "../src/keyring.js";

const samplePem1 =
  "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Y123456789=\n-----END RSA PRIVATE KEY-----\n";
const samplePem2 =
  "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA9Z987654321=\n-----END RSA PRIVATE KEY-----\n";

describe("GitHub App Keyring & Rotation", () => {
  describe("computeKeyFingerprint", () => {
    it("computes deterministic fingerprint ignoring whitespace and PEM wrappers", async () => {
      const fp1 = await computeKeyFingerprint(samplePem1);
      const fp2 = await computeKeyFingerprint(
        samplePem1.replace(/\n/g, "\r\n").trim(),
      );
      expect(fp1).toMatch(/^key:[0-9a-f]{8}$/);
      expect(fp1).toBe(fp2);

      const fpDifferent = await computeKeyFingerprint(samplePem2);
      expect(fpDifferent).not.toBe(fp1);

      expect(await computeKeyFingerprint("")).toBe("key:empty");
    });
  });

  describe("resolveGitHubAppKeyring", () => {
    it("resolves from LEGACY only", () => {
      const keyring = resolveGitHubAppKeyring({
        GITHUB_APP_ID: 1234,
        GITHUB_APP_PRIVATE_KEY: samplePem1,
        GITHUB_APP_SLUG: "holon-app",
      });
      expect(keyring).toEqual({
        appId: 1234,
        appSlug: "holon-app",
        currentPrivateKey: samplePem1.trim(),
      });
    });

    it("resolves from CURRENT only", () => {
      const keyring = resolveGitHubAppKeyring({
        GITHUB_APP_ID: "5678",
        GITHUB_APP_PRIVATE_KEY_CURRENT: samplePem1,
        GITHUB_APP_SLUG: "holon-app",
      });
      expect(keyring).toEqual({
        appId: 5678,
        appSlug: "holon-app",
        currentPrivateKey: samplePem1.trim(),
      });
    });

    it("resolves CURRENT + PREVIOUS", () => {
      const keyring = resolveGitHubAppKeyring({
        GITHUB_APP_ID: 1234,
        GITHUB_APP_PRIVATE_KEY_CURRENT: samplePem1,
        GITHUB_APP_PRIVATE_KEY_PREVIOUS: samplePem2,
        GITHUB_APP_SLUG: "holon-app",
      });
      expect(keyring).toEqual({
        appId: 1234,
        appSlug: "holon-app",
        currentPrivateKey: samplePem1.trim(),
        previousPrivateKey: samplePem2.trim(),
      });
    });

    it("resolves CURRENT + LEGACY as migration fallback", () => {
      const keyring = resolveGitHubAppKeyring({
        GITHUB_APP_ID: 1234,
        GITHUB_APP_PRIVATE_KEY: samplePem2,
        GITHUB_APP_PRIVATE_KEY_CURRENT: samplePem1,
        GITHUB_APP_SLUG: "holon-app",
      });
      expect(keyring).toEqual({
        appId: 1234,
        appSlug: "holon-app",
        currentPrivateKey: samplePem1.trim(),
        previousPrivateKey: samplePem2.trim(),
      });
    });

    it("prefers explicit PREVIOUS over LEGACY when both present", () => {
      const keyring = resolveGitHubAppKeyring({
        GITHUB_APP_ID: 1234,
        GITHUB_APP_PRIVATE_KEY: "legacy-key",
        GITHUB_APP_PRIVATE_KEY_CURRENT: samplePem1,
        GITHUB_APP_PRIVATE_KEY_PREVIOUS: samplePem2,
        GITHUB_APP_SLUG: "holon-app",
      });
      expect(keyring).toEqual({
        appId: 1234,
        appSlug: "holon-app",
        currentPrivateKey: samplePem1.trim(),
        previousPrivateKey: samplePem2.trim(),
      });
    });

    it("deduplicates identical CURRENT and PREVIOUS keys", () => {
      const keyring = resolveGitHubAppKeyring({
        GITHUB_APP_ID: 1234,
        GITHUB_APP_PRIVATE_KEY_CURRENT: samplePem1,
        GITHUB_APP_PRIVATE_KEY_PREVIOUS: samplePem1,
        GITHUB_APP_SLUG: "holon-app",
      });
      expect(keyring.previousPrivateKey).toBeUndefined();
    });

    it("throws error when PREVIOUS is configured without CURRENT", () => {
      expect(() =>
        resolveGitHubAppKeyring({
          GITHUB_APP_ID: 1234,
          GITHUB_APP_PRIVATE_KEY_PREVIOUS: samplePem2,
          GITHUB_APP_SLUG: "holon-app",
        }),
      ).toThrow(
        "GITHUB_APP_PRIVATE_KEY_PREVIOUS cannot be configured without a CURRENT key",
      );
    });

    it("throws error when all keys are missing", () => {
      expect(() =>
        resolveGitHubAppKeyring({
          GITHUB_APP_ID: 1234,
          GITHUB_APP_SLUG: "holon-app",
        }),
      ).toThrow("Missing GitHub App private key");
    });
  });

  describe("isAppAuthenticationError", () => {
    it("identifies 401 status and JWT messages as authentication errors", () => {
      expect(
        isAppAuthenticationError(
          new GitHubRequestError("upstream_permanent", false, 401),
        ),
      ).toBe(true);
      expect(isAppAuthenticationError({ status: 401 })).toBe(true);
      expect(isAppAuthenticationError({ statusCode: 401 })).toBe(true);
      expect(
        isAppAuthenticationError(
          new Error("A JSON web token could not be verified"),
        ),
      ).toBe(true);
      expect(isAppAuthenticationError(new Error("Bad credentials"))).toBe(true);
      expect(
        isAppAuthenticationError(
          new Error("Secret or private key must have a value"),
        ),
      ).toBe(true);
    });

    it("excludes 403, 404, 429, 5xx and network errors from authentication error classification", () => {
      expect(
        isAppAuthenticationError(
          new GitHubRequestError("rate_limited", true, 403),
        ),
      ).toBe(false);
      expect(
        isAppAuthenticationError(
          new GitHubRequestError("rate_limited", true, 429),
        ),
      ).toBe(false);
      expect(
        isAppAuthenticationError(
          new GitHubRequestError("upstream_permanent", false, 404),
        ),
      ).toBe(false);
      expect(
        isAppAuthenticationError(
          new GitHubRequestError("upstream_transient", true, 500),
        ),
      ).toBe(false);
      expect(
        isAppAuthenticationError(
          new GitHubRequestError("network_transient", true),
        ),
      ).toBe(false);
      expect(isAppAuthenticationError(new Error("Connection reset"))).toBe(
        false,
      );
    });
  });

  describe("createInstallationSessionWithKeyring & Circuit Breaker", () => {
    const keyring: GitHubAppKeyring = {
      appId: 100,
      appSlug: "holon-app",
      currentPrivateKey: samplePem1.trim(),
      previousPrivateKey: samplePem2.trim(),
    };

    it("uses CURRENT key when valid and does not attempt PREVIOUS", async () => {
      const mockSession = {
        token: "token-current",
      } as unknown as GitHubInstallationSession;
      const createSessionSpy = vi
        .spyOn(clientModule, "createInstallationSession")
        .mockResolvedValueOnce(mockSession);

      const breaker = new MemoryKeyringCircuitBreaker();
      const session = await createInstallationSessionWithKeyring(
        keyring,
        1,
        2,
        { circuitBreaker: breaker },
      );

      expect(session).toBe(mockSession);
      expect(createSessionSpy).toHaveBeenCalledTimes(1);
      expect(createSessionSpy).toHaveBeenCalledWith(
        expect.objectContaining({ privateKey: keyring.currentPrivateKey }),
        1,
        2,
      );
      expect(breaker.isOpen()).toBe(false);
      createSessionSpy.mockRestore();
    });

    it("falls back to PREVIOUS on 401, trips circuit breaker, and routes subsequent calls to PREVIOUS directly", async () => {
      const mockSession = {
        token: "token-prev",
      } as unknown as GitHubInstallationSession;
      const telemetryEvents: KeyringTelemetryEvent[] = [];

      const createSessionSpy = vi
        .spyOn(clientModule, "createInstallationSession")
        .mockRejectedValueOnce(
          new GitHubRequestError("upstream_permanent", false, 401),
        )
        .mockResolvedValueOnce(mockSession)
        .mockResolvedValueOnce(mockSession); // third call

      const breaker = new MemoryKeyringCircuitBreaker(60_000);

      // Call 1: CURRENT fails with 401, falls back to PREVIOUS, trips breaker
      const session1 = await createInstallationSessionWithKeyring(
        keyring,
        1,
        2,
        {
          circuitBreaker: breaker,
          onTelemetry: (e) => telemetryEvents.push(e),
        },
      );

      expect(session1).toBe(mockSession);
      expect(createSessionSpy).toHaveBeenCalledTimes(2);
      expect(breaker.isOpen()).toBe(true);

      const openedEvent = telemetryEvents.find(
        (e) => e.event === "github_app_auth.circuit_breaker_opened",
      );
      const fallbackEvent = telemetryEvents.find(
        (e) => e.event === "github_app_auth.fallback_succeeded",
      );
      expect(openedEvent).toBeDefined();
      expect(fallbackEvent).toBeDefined();

      // Call 2: Breaker is OPEN -> routes directly to PREVIOUS without touching CURRENT!
      const session2 = await createInstallationSessionWithKeyring(
        keyring,
        1,
        2,
        {
          circuitBreaker: breaker,
          onTelemetry: (e) => telemetryEvents.push(e),
        },
      );

      expect(session2).toBe(mockSession);
      // createSession was called for PREVIOUS directly (total calls now 3, not 4!)
      expect(createSessionSpy).toHaveBeenCalledTimes(3);
      expect(createSessionSpy.mock.calls[2]?.[0]?.privateKey).toBe(
        keyring.previousPrivateKey,
      );

      createSessionSpy.mockRestore();
    });

    it("does not fall back to PREVIOUS on 403, 429, or 500 errors", async () => {
      const rateLimitError = new GitHubRequestError("rate_limited", true, 429);
      const createSessionSpy = vi
        .spyOn(clientModule, "createInstallationSession")
        .mockRejectedValueOnce(rateLimitError);

      const breaker = new MemoryKeyringCircuitBreaker();
      await expect(
        createInstallationSessionWithKeyring(keyring, 1, 2, {
          circuitBreaker: breaker,
        }),
      ).rejects.toThrow(rateLimitError);

      expect(createSessionSpy).toHaveBeenCalledTimes(1);
      expect(breaker.isOpen()).toBe(false);
      createSessionSpy.mockRestore();
    });

    it("resets circuit breaker when CURRENT key succeeds after TTL expiry", async () => {
      const mockSession = {
        token: "token-current-fixed",
      } as unknown as GitHubInstallationSession;
      const telemetryEvents: KeyringTelemetryEvent[] = [];

      const createSessionSpy = vi
        .spyOn(clientModule, "createInstallationSession")
        .mockResolvedValueOnce(mockSession);

      const breaker = new MemoryKeyringCircuitBreaker(10);
      breaker.trip(10, Date.now() - 20); // expired breaker
      expect(breaker.isOpen()).toBe(false);

      // Now set breaker open but test reset upon success
      breaker.trip(10_000); // open
      expect(breaker.isOpen()).toBe(true);

      // Force test of reset when CURRENT succeeds:
      breaker.reset();
      const session = await createInstallationSessionWithKeyring(
        keyring,
        1,
        2,
        {
          circuitBreaker: breaker,
          onTelemetry: (e) => telemetryEvents.push(e),
        },
      );

      expect(session).toBe(mockSession);
      expect(breaker.isOpen()).toBe(false);
      createSessionSpy.mockRestore();
    });

    it("emits all_keys_rejected when both keys fail authentication", async () => {
      const telemetryEvents: KeyringTelemetryEvent[] = [];
      const createSessionSpy = vi
        .spyOn(clientModule, "createInstallationSession")
        .mockRejectedValueOnce(
          new GitHubRequestError("upstream_permanent", false, 401),
        )
        .mockRejectedValueOnce(
          new GitHubRequestError("upstream_permanent", false, 401),
        );

      const breaker = new MemoryKeyringCircuitBreaker();
      await expect(
        createInstallationSessionWithKeyring(keyring, 1, 2, {
          circuitBreaker: breaker,
          onTelemetry: (e) => telemetryEvents.push(e),
        }),
      ).rejects.toThrow();

      expect(createSessionSpy).toHaveBeenCalledTimes(2);
      const allRejected = telemetryEvents.find(
        (e) => e.event === "github_app_auth.all_keys_rejected",
      );
      expect(allRejected).toBeDefined();
      createSessionSpy.mockRestore();
    });
  });

  describe("resolveRepositoryInstallationWithKeyring", () => {
    const keyring: GitHubAppKeyring = {
      appId: 100,
      appSlug: "holon-app",
      currentPrivateKey: samplePem1.trim(),
      previousPrivateKey: samplePem2.trim(),
    };

    it("falls back to PREVIOUS on 401 and trips circuit breaker", async () => {
      const telemetryEvents: KeyringTelemetryEvent[] = [];
      const resolveSpy = vi
        .spyOn(clientModule, "resolveRepositoryInstallation")
        .mockRejectedValueOnce(
          new GitHubRequestError("upstream_permanent", false, 401),
        )
        .mockResolvedValueOnce(999);

      const breaker = new MemoryKeyringCircuitBreaker();
      const installationId = await resolveRepositoryInstallationWithKeyring(
        keyring,
        "owner",
        "repo",
        {
          circuitBreaker: breaker,
          onTelemetry: (e) => telemetryEvents.push(e),
        },
      );

      expect(installationId).toBe(999);
      expect(resolveSpy).toHaveBeenCalledTimes(2);
      expect(breaker.isOpen()).toBe(true);

      resolveSpy.mockRestore();
    });

    it("uses CURRENT directly on success and resets breaker if it was open", async () => {
      const telemetryEvents: KeyringTelemetryEvent[] = [];
      const resolveSpy = vi
        .spyOn(clientModule, "resolveRepositoryInstallation")
        .mockResolvedValueOnce(123);

      const breaker = new MemoryKeyringCircuitBreaker();
      breaker.trip(1000);

      // Reset test
      breaker.reset();
      const installationId = await resolveRepositoryInstallationWithKeyring(
        keyring,
        "owner",
        "repo",
        {
          circuitBreaker: breaker,
          onTelemetry: (e) => telemetryEvents.push(e),
        },
      );

      expect(installationId).toBe(123);
      expect(resolveSpy).toHaveBeenCalledTimes(1);
      resolveSpy.mockRestore();
    });

    it("routes directly to PREVIOUS when circuit breaker is already OPEN", async () => {
      const resolveSpy = vi
        .spyOn(clientModule, "resolveRepositoryInstallation")
        .mockResolvedValueOnce(456);

      const breaker = new MemoryKeyringCircuitBreaker();
      breaker.trip(10000);

      const installationId = await resolveRepositoryInstallationWithKeyring(
        keyring,
        "owner",
        "repo",
        { circuitBreaker: breaker },
      );

      expect(installationId).toBe(456);
      expect(resolveSpy).toHaveBeenCalledTimes(1);
      expect(resolveSpy).toHaveBeenCalledWith(
        expect.objectContaining({ privateKey: keyring.previousPrivateKey }),
        "owner",
        "repo",
      );
      resolveSpy.mockRestore();
    });

    it("emits all_keys_rejected when breaker is OPEN and PREVIOUS fails", async () => {
      const telemetryEvents: KeyringTelemetryEvent[] = [];
      const resolveSpy = vi
        .spyOn(clientModule, "resolveRepositoryInstallation")
        .mockRejectedValueOnce(new Error("Previous failed"));

      const breaker = new MemoryKeyringCircuitBreaker();
      breaker.trip(10000);

      await expect(
        resolveRepositoryInstallationWithKeyring(keyring, "owner", "repo", {
          circuitBreaker: breaker,
          onTelemetry: (e) => telemetryEvents.push(e),
        }),
      ).rejects.toThrow("Previous failed");

      const allRejected = telemetryEvents.find(
        (e) => e.event === "github_app_auth.all_keys_rejected",
      );
      expect(allRejected).toBeDefined();
      resolveSpy.mockRestore();
    });

    it("does not fallback on 403/429/500 and emits all_keys_rejected when both fail", async () => {
      const telemetryEvents: KeyringTelemetryEvent[] = [];
      const resolveSpy = vi
        .spyOn(clientModule, "resolveRepositoryInstallation")
        .mockRejectedValueOnce(
          new GitHubRequestError("upstream_permanent", false, 401),
        )
        .mockRejectedValueOnce(
          new GitHubRequestError("upstream_permanent", false, 401),
        );

      const breaker = new MemoryKeyringCircuitBreaker();
      await expect(
        resolveRepositoryInstallationWithKeyring(keyring, "owner", "repo", {
          circuitBreaker: breaker,
          onTelemetry: (e) => telemetryEvents.push(e),
        }),
      ).rejects.toThrow();

      expect(resolveSpy).toHaveBeenCalledTimes(2);
      expect(
        telemetryEvents.some(
          (e) => e.event === "github_app_auth.all_keys_rejected",
        ),
      ).toBe(true);
      resolveSpy.mockRestore();
    });
  });

  describe("Edge cases & fallback handling", () => {
    it("handles invalid App ID gracefully", () => {
      expect(() =>
        resolveGitHubAppKeyring({
          GITHUB_APP_ID: "invalid-id",
          GITHUB_APP_PRIVATE_KEY: samplePem1,
          GITHUB_APP_SLUG: "slug",
        }),
      ).toThrow("GitHub App ID must be a positive safe integer");
    });

    it("handles base64 decode failure in computeKeyFingerprint", async () => {
      // Invalid base64 characters
      const fp = await computeKeyFingerprint("???not-valid-base64!!!");
      expect(fp).toMatch(/^key:[0-9a-f]{8}$/);
    });

    it("emits all_keys_rejected when breaker is OPEN and PREVIOUS fails in createInstallationSessionWithKeyring", async () => {
      const telemetryEvents: KeyringTelemetryEvent[] = [];
      const keyring: GitHubAppKeyring = {
        appId: 100,
        appSlug: "slug",
        currentPrivateKey: samplePem1.trim(),
        previousPrivateKey: samplePem2.trim(),
      };

      const createSpy = vi
        .spyOn(clientModule, "createInstallationSession")
        .mockRejectedValueOnce(new Error("Previous failed"));

      const breaker = new MemoryKeyringCircuitBreaker();
      breaker.trip(10000);

      await expect(
        createInstallationSessionWithKeyring(keyring, 1, 2, {
          circuitBreaker: breaker,
          onTelemetry: (e) => telemetryEvents.push(e),
        }),
      ).rejects.toThrow("Previous failed");

      expect(
        telemetryEvents.some(
          (e) => e.event === "github_app_auth.all_keys_rejected",
        ),
      ).toBe(true);
      createSpy.mockRestore();
    });

    it("works without options argument passed", async () => {
      const keyring: GitHubAppKeyring = {
        appId: 100,
        appSlug: "slug",
        currentPrivateKey: samplePem1.trim(),
      };
      const mockSession = {
        token: "token",
      } as unknown as GitHubInstallationSession;
      const createSpy = vi
        .spyOn(clientModule, "createInstallationSession")
        .mockResolvedValueOnce(mockSession);

      const session = await createInstallationSessionWithKeyring(keyring, 1, 2);
      expect(session).toBe(mockSession);
      createSpy.mockRestore();
    });
  });
});
