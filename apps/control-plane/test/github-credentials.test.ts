import { describe, expect, it, vi } from "vitest";

import {
  createKeyringTelemetryOptions,
  resolveControlPlaneKeyring,
} from "../src/github-credentials.js";

describe("github-credentials", () => {
  it("resolves keyring using resolveControlPlaneKeyring", () => {
    const keyring = resolveControlPlaneKeyring({
      GITHUB_APP_ID: "42",
      GITHUB_APP_PRIVATE_KEY_CURRENT: "current-key",
      GITHUB_APP_PRIVATE_KEY_PREVIOUS: "prev-key",
      GITHUB_APP_SLUG: "holon",
    } as unknown as Cloudflare.Env);

    expect(keyring.appId).toBe(42);
    expect(keyring.currentPrivateKey).toBe("current-key");
    expect(keyring.previousPrivateKey).toBe("prev-key");
    expect(keyring.appSlug).toBe("holon");
  });

  it("creates telemetry options and forwards events to structured logger", () => {
    expect(createKeyringTelemetryOptions(undefined)).toEqual({});

    const emit = vi.fn();
    const mockLogger = { emit };

    const options = createKeyringTelemetryOptions(mockLogger, {
      prKey: "github:1:pr:2",
    });
    expect(options.onTelemetry).toBeDefined();

    options.onTelemetry?.({
      event: "github_app_auth.circuit_breaker_opened",
      fields: { currentFingerprint: "key:12345678" },
    });

    expect(emit).toHaveBeenCalledWith(
      "github_app_auth.circuit_breaker_opened",
      {
        currentFingerprint: "key:12345678",
        prKey: "github:1:pr:2",
      },
    );
  });
});
