import type { AuthService } from "@holon/auth/server";
import {
  deriveRateLimitKey,
  PreferencesError,
} from "@holon/db/identity/server";
import { createStaticHandler } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { readDashboardViewer } from "../app/server/viewer.server.js";

function fixture() {
  const getAdmittedUser = vi.fn().mockResolvedValue({
    user: {
      id: "user_a",
      name: "User A",
      githubAccountId: "github_1",
      sessionId: "session_a",
      expiresAt: "2030-01-08T00:00:00.000Z",
    },
    status: "admitted",
    headers: new Headers({
      "Set-Cookie": "native-renewal=value; Secure; HttpOnly",
    }),
  });
  const rateLimitStorage = {
    consume: vi.fn().mockResolvedValue({ allowed: true, retryAfter: null }),
  };
  const authService = {
    getAdmittedUser,
    rateLimitStorage,
  } as unknown as AuthService;
  const preferencesPersistence = {
    readPreferences: vi
      .fn()
      .mockResolvedValue({ locale: "pt-BR", timezone: "UTC" }),
    updatePreferences: vi.fn(),
  };
  return {
    getAdmittedUser,
    rateLimitStorage,
    authService,
    preferencesPersistence,
    authSecret: "synthetic-viewer-secret-at-least-32-characters",
  };
}
const request = new Request("https://dashboard.example.invalid/");
describe("server viewer boundary", () => {
  it("shares session/profile read budgets with their HTTP surfaces before reading storage", async () => {
    const services = fixture();
    services.rateLimitStorage.consume.mockResolvedValue({
      allowed: false,
      retryAfter: 37,
    });
    const failure = await readDashboardViewer(request, services).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Response);
    expect((failure as Response).status).toBe(429);
    expect((failure as Response).headers.get("Retry-After")).toBe("37");
    expect(services.getAdmittedUser).not.toHaveBeenCalled();
    expect(
      services.preferencesPersistence.readPreferences,
    ).not.toHaveBeenCalled();
  });
  it.each([
    [new Error("private SQL payload"), 503],
    [{ locale: "en", timezone: "Unknown/Zone" }, 503],
    [new PreferencesError("user_not_admitted"), 403],
  ])(
    "preserves renewal cookies when profile resolution fails %#",
    async (failure, status) => {
      const services = fixture();
      if (failure instanceof Error)
        services.preferencesPersistence.readPreferences.mockRejectedValue(
          failure,
        );
      else
        services.preferencesPersistence.readPreferences.mockResolvedValue(
          failure,
        );
      const response = await readDashboardViewer(request, services).catch(
        (error: unknown) => error,
      );
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(status);
      expect((response as Response).headers.getSetCookie()).toEqual([
        "native-renewal=value; Secure; HttpOnly",
      ]);
      expect(await (response as Response).text()).not.toMatch(
        /private SQL|Unknown\/Zone/u,
      );
    },
  );
  it("lets React Router retain sanitized denial status and all loader renewal headers", async () => {
    const services = fixture();
    services.preferencesPersistence.readPreferences.mockRejectedValue(
      new Error("private SQL payload"),
    );
    const router = createStaticHandler([
      {
        id: "root",
        path: "/",
        loader: ({ request: loaderRequest }) =>
          readDashboardViewer(loaderRequest, services),
      },
    ]);
    const result = await router.query(request);
    if (result instanceof Response)
      throw new Error("Expected a loader error context");
    expect(result.statusCode).toBe(503);
    expect(result.loaderHeaders.root!.getSetCookie()).toEqual([
      "native-renewal=value; Secure; HttpOnly",
    ]);
    expect(JSON.stringify(result.errors)).not.toContain("private SQL payload");
  });
  it("preserves renewal on a profile budget denial without reading preferences", async () => {
    const services = fixture();
    services.rateLimitStorage.consume
      .mockResolvedValueOnce({ allowed: true, retryAfter: null })
      .mockResolvedValueOnce({ allowed: false, retryAfter: 19 });
    const response = await readDashboardViewer(request, services).catch(
      (error: unknown) => error,
    );
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(429);
    expect((response as Response).headers.getSetCookie()).toEqual([
      "native-renewal=value; Secure; HttpOnly",
    ]);
    expect(
      services.preferencesPersistence.readPreferences,
    ).not.toHaveBeenCalled();
  });
  it("preserves cookie renewal while exposing only public identity and validated preferences", async () => {
    const services = fixture();
    const result = await readDashboardViewer(request, services);
    expect(services.rateLimitStorage.consume.mock.calls).toEqual([
      [
        await deriveRateLimitKey("read", "anonymous", "/api/auth/session"),
        { window: 60, max: 120 },
      ],
      [
        await deriveRateLimitKey("read", "anonymous", "/api/preferences"),
        { window: 60, max: 120 },
      ],
    ]);
    expect(result.viewer).toMatchObject({
      status: "authenticated",
      user: { id: "user_a", name: "User A" },
      preferences: { locale: "pt-BR", timezone: "UTC" },
    });
    expect(JSON.stringify(result.viewer)).not.toMatch(
      /githubAccountId|native-renewal|synthetic-viewer-secret/u,
    );
    expect(result.headers.getSetCookie()).toHaveLength(2);
    expect(result.headers.getSetCookie()[0]).toContain("native-renewal");
    expect(result.headers.getSetCookie()[1]).toMatch(
      /^holon_csrf=[0-9a-f]{64};/u,
    );
  });
  it("does not reinterpret failed persistence as a missing personal preference", async () => {
    const services = fixture();
    services.preferencesPersistence.readPreferences.mockRejectedValue(
      new Error("private SQL payload"),
    );
    await expect(readDashboardViewer(request, services)).rejects.toMatchObject({
      status: 503,
    });
    services.preferencesPersistence.readPreferences.mockResolvedValue({
      locale: "pt-BR",
      timezone: "Unknown/Zone",
    });
    await expect(readDashboardViewer(request, services)).rejects.toMatchObject({
      status: 503,
    });
  });
  it("denies incomplete identity composition", async () => {
    const services = fixture();
    await expect(
      readDashboardViewer(request, { authService: services.authService }),
    ).rejects.toMatchObject({ status: 503 });
  });
  it.each(["anonymous", "disconnected"])(
    "does not read preferences for %s",
    async (status) => {
      const services = fixture();
      services.getAdmittedUser.mockResolvedValue({
        user: null,
        status,
        headers: new Headers({ "Set-Cookie": "clear=value" }),
      });
      const result = await readDashboardViewer(request, services);
      expect(result.viewer).toEqual({ status });
      expect(
        services.preferencesPersistence.readPreferences,
      ).not.toHaveBeenCalled();
      expect(result.headers.getSetCookie()).toEqual(["clear=value"]);
    },
  );
  it("retains the foundation-only mode when authentication is disabled", async () => {
    expect((await readDashboardViewer(request, {})).viewer).toEqual({
      status: "disabled",
    });
  });
});
