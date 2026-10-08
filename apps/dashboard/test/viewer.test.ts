import type { AuthService } from "@holon/auth/server";
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
  const authService = { getAdmittedUser } as unknown as AuthService;
  const preferencesPersistence = {
    readPreferences: vi
      .fn()
      .mockResolvedValue({ locale: "pt-BR", timezone: "UTC" }),
    updatePreferences: vi.fn(),
  };
  return {
    getAdmittedUser,
    authService,
    preferencesPersistence,
    authSecret: "synthetic-viewer-secret-at-least-32-characters",
  };
}
const request = new Request("https://dashboard.example.invalid/");
describe("server viewer boundary", () => {
  it("preserves cookie renewal while exposing only public identity and validated preferences", async () => {
    const services = fixture();
    const result = await readDashboardViewer(request, services);
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
    await expect(readDashboardViewer(request, services)).rejects.toThrow();
    services.preferencesPersistence.readPreferences.mockResolvedValue({
      locale: "pt-BR",
      timezone: "Unknown/Zone",
    });
    await expect(readDashboardViewer(request, services)).rejects.toThrow();
  });
  it("denies incomplete identity composition", async () => {
    const services = fixture();
    await expect(
      readDashboardViewer(request, { authService: services.authService }),
    ).rejects.toThrow("unavailable");
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
