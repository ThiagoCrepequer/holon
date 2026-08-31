import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  auth: vi.fn(),
  createAppAuth: vi.fn(),
  octokitOptions: undefined as unknown,
  paginateIterator: vi.fn(),
  request: vi.fn(),
}));

vi.mock("@octokit/auth-app", () => ({ createAppAuth: sdk.createAppAuth }));
vi.mock("@octokit/core", () => ({
  Octokit: class {
    public constructor(options: unknown) {
      sdk.octokitOptions = options;
    }

    public request(route: string, parameters: Record<string, unknown>) {
      return sdk.request(route, parameters);
    }

    public static plugin() {
      return class {
        public readonly paginate = {
          iterator: (route: string, parameters: Record<string, unknown>) =>
            sdk.paginateIterator(route, parameters),
        };

        public constructor(options: unknown) {
          sdk.octokitOptions = options;
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

import {
  createInstallationSession,
  resolveRepositoryInstallation,
} from "../src/client.js";

describe("GitHub installation client", () => {
  beforeEach(() => {
    sdk.createAppAuth.mockReturnValue(sdk.auth);
    sdk.auth.mockResolvedValue({
      expiresAt: "2026-08-29T13:00:00.000Z",
      token: "installation-token",
    });
    sdk.paginateIterator.mockImplementation(async function* () {
      yield {
        data: [
          {
            body: "comment",
            id: 1,
            user: { login: "holon[bot]", type: "Bot" },
          },
        ],
      };
    });
    sdk.request.mockResolvedValue({ data: { id: 2 } });
  });

  it("mints an installation token and exposes the bounded Octokit adapter", async () => {
    const session = await createInstallationSession(
      {
        appId: 123,
        appSlug: "holon-reviewer",
        privateKey: "private-key",
      },
      99,
      42,
    );

    expect(sdk.createAppAuth).toHaveBeenCalledWith({
      appId: 123,
      privateKey: "private-key",
    });
    expect(sdk.auth).toHaveBeenCalledWith({
      installationId: 99,
      repositoryIds: [42],
      type: "installation",
    });
    expect(session).toMatchObject({
      expiresAt: "2026-08-29T13:00:00.000Z",
      expectedAuthorLogin: "holon-reviewer[bot]",
      token: "installation-token",
    });
    const pages = [];
    for await (const page of session.api.iterate(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/comments",
      { owner: "acme", per_page: 100, pull_number: 7, repo: "api" },
    )) {
      pages.push(page);
    }
    expect(pages).toEqual([
      [
        {
          body: "comment",
          id: 1,
          user: { login: "holon[bot]", type: "Bot" },
        },
      ],
    ]);
    await expect(
      session.api.request("POST route", { body: "x" }),
    ).resolves.toEqual({ data: { id: 2 } });
    sdk.request.mockResolvedValueOnce({
      data: { head: { sha: "a".repeat(40) } },
    });
    await expect(session.currentHeadSha("acme", "api", 7)).resolves.toBe(
      "a".repeat(40),
    );
    sdk.request.mockResolvedValueOnce({ data: "diff --git a/a.ts b/a.ts" });
    await expect(session.pullRequestDiff("acme", "api", 7)).resolves.toBe(
      "diff --git a/a.ts b/a.ts",
    );
    expect(sdk.request).toHaveBeenLastCalledWith(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      {
        mediaType: { format: "diff" },
        owner: "acme",
        pull_number: 7,
        repo: "api",
      },
    );

    const options = sdk.octokitOptions as {
      readonly auth: string;
      readonly throttle: { onRateLimit(): void; onSecondaryRateLimit(): void };
    };
    expect(options.auth).toBe("installation-token");
    expect(options.throttle.onRateLimit()).toBeUndefined();
    expect(options.throttle.onSecondaryRateLimit()).toBeUndefined();
  });

  it("rejects a pull request diff that exceeds the executor boundary", async () => {
    const session = await createInstallationSession(
      {
        appId: 123,
        appSlug: "holon-reviewer",
        privateKey: "private-key",
      },
      99,
      42,
    );
    sdk.request.mockResolvedValueOnce({ data: "x".repeat(2_000_001) });

    await expect(
      session.pullRequestDiff("acme", "api", 7),
    ).rejects.toMatchObject({
      name: "GitHubDiffTooLargeError",
    });
  });

  it("rejects invalid session identity and non-text diff responses", async () => {
    await expect(
      createInstallationSession(
        { appId: 123, appSlug: "invalid slug", privateKey: "private-key" },
        99,
        42,
      ),
    ).rejects.toThrow("GitHub App slug");
    await expect(
      createInstallationSession(
        { appId: 123, appSlug: "holon", privateKey: "private-key" },
        99,
        0,
      ),
    ).rejects.toThrow("repositoryId");

    const session = await createInstallationSession(
      { appId: 123, appSlug: "holon", privateKey: "private-key" },
      99,
      42,
    );
    sdk.request.mockResolvedValueOnce({ data: { diff: "not text" } });
    await expect(
      session.pullRequestDiff("acme", "api", 7),
    ).rejects.toMatchObject({ code: "invalid_response", retryable: false });
  });

  it("parses review pages with nullable authors and omitted bodies", async () => {
    const session = await createInstallationSession(
      { appId: 123, appSlug: "holon", privateKey: "private-key" },
      99,
      42,
    );
    sdk.paginateIterator.mockImplementationOnce(async function* () {
      yield { data: [{ id: 7, user: null }] };
    });

    const pages = [];
    for await (const page of session.api.iterate(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
      { owner: "acme", per_page: 100, pull_number: 7, repo: "api" },
    )) {
      pages.push(page);
    }
    expect(pages).toEqual([[{ id: 7, user: null }]]);
    expect(sdk.paginateIterator).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
      expect.any(Object),
    );
  });

  it("resolves the installation from repository identity for the v1 drain path", async () => {
    sdk.auth.mockResolvedValueOnce({ token: "app-jwt", type: "app" });
    sdk.request.mockResolvedValueOnce({ data: { id: 99 } });

    await expect(
      resolveRepositoryInstallation(
        {
          appId: 123,
          appSlug: "holon-reviewer",
          privateKey: "private-key",
        },
        "acme",
        "api",
      ),
    ).resolves.toBe(99);
    expect(sdk.auth).toHaveBeenCalledWith({ type: "app" });
    expect(sdk.request).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/installation",
      { owner: "acme", repo: "api" },
    );
  });
});
