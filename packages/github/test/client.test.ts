import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  auth: vi.fn(),
  createAppAuth: vi.fn(),
  octokitOptions: undefined as unknown,
  paginate: vi.fn(),
  request: vi.fn(),
}));

vi.mock("@octokit/auth-app", () => ({ createAppAuth: sdk.createAppAuth }));
vi.mock("@octokit/core", () => ({
  Octokit: class {
    public static plugin() {
      return class {
        public constructor(options: unknown) {
          sdk.octokitOptions = options;
        }

        public paginate(route: string, parameters: Record<string, unknown>) {
          return sdk.paginate(route, parameters);
        }

        public request(route: string, parameters: Record<string, unknown>) {
          return sdk.request(route, parameters);
        }
      };
    }
  },
}));
vi.mock("@octokit/plugin-paginate-rest", () => ({ paginateRest: vi.fn() }));
vi.mock("@octokit/plugin-retry", () => ({ retry: vi.fn() }));
vi.mock("@octokit/plugin-throttling", () => ({ throttling: vi.fn() }));

import { createInstallationSession } from "../src/client.js";

describe("GitHub installation client", () => {
  beforeEach(() => {
    sdk.createAppAuth.mockReturnValue(sdk.auth);
    sdk.auth.mockResolvedValue({
      expiresAt: "2026-08-29T13:00:00.000Z",
      token: "installation-token",
    });
    sdk.paginate.mockResolvedValue([{ body: "comment", id: 1 }]);
    sdk.request.mockResolvedValue({ data: { id: 2 } });
  });

  it("mints an installation token and exposes the bounded Octokit adapter", async () => {
    const session = await createInstallationSession(
      { appId: 123, privateKey: "private-key" },
      99,
    );

    expect(sdk.createAppAuth).toHaveBeenCalledWith({
      appId: 123,
      privateKey: "private-key",
    });
    expect(sdk.auth).toHaveBeenCalledWith({
      installationId: 99,
      type: "installation",
    });
    expect(session).toMatchObject({
      expiresAt: "2026-08-29T13:00:00.000Z",
      token: "installation-token",
    });
    await expect(
      session.api.paginate("GET route", { page: 1 }),
    ).resolves.toEqual([{ body: "comment", id: 1 }]);
    await expect(
      session.api.request("POST route", { body: "x" }),
    ).resolves.toEqual({ data: { id: 2 } });
    sdk.request.mockResolvedValueOnce({
      data: { head: { sha: "a".repeat(40) } },
    });
    await expect(session.currentHeadSha("acme", "api", 7)).resolves.toBe(
      "a".repeat(40),
    );

    const options = sdk.octokitOptions as {
      readonly auth: string;
      readonly throttle: { onRateLimit(): void; onSecondaryRateLimit(): void };
    };
    expect(options.auth).toBe("installation-token");
    expect(options.throttle.onRateLimit()).toBeUndefined();
    expect(options.throttle.onSecondaryRateLimit()).toBeUndefined();
  });
});
