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
import { isAppAuthenticationError } from "../src/keyring.js";

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

    sdk.request.mockResolvedValueOnce({ data: { permission: "write" } });
    await expect(
      session.repositoryPermission?.("acme", "api", "alice"),
    ).resolves.toBe("write");
    expect(sdk.request).toHaveBeenLastCalledWith(
      "GET /repos/{owner}/{repo}/collaborators/{username}/permission",
      { owner: "acme", repo: "api", username: "alice" },
    );

    sdk.request.mockResolvedValueOnce({
      data: {
        artifacts: [
          {
            archive_download_url: "https://api.github.com/zip",
            id: 101,
            name: "coverage-report",
            size_in_bytes: 2048,
          },
        ],
        total_count: 1,
      },
    });
    await expect(
      session.listWorkflowRunArtifacts?.("acme", "api", 555),
    ).resolves.toEqual([
      {
        archiveDownloadUrl: "https://api.github.com/zip",
        id: 101,
        name: "coverage-report",
        sizeInBytes: 2048,
      },
    ]);

    const bytes = new Uint8Array([1, 2, 3, 4]);
    sdk.request.mockResolvedValueOnce({
      headers: {},
      data: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    });
    expect(
      new Uint8Array(await session.downloadArtifactZip!("acme", "api", 101)),
    ).toEqual(bytes);
    expect(sdk.request).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ request: { parseSuccessResponseBody: false } }),
    );

    const options = sdk.octokitOptions as {
      readonly auth: string;
      readonly throttle: { onRateLimit(): void; onSecondaryRateLimit(): void };
    };
    expect(options.auth).toBe("installation-token");
    expect(options.throttle.onRateLimit()).toBeUndefined();
    expect(options.throttle.onSecondaryRateLimit()).toBeUndefined();
  });

  it("preserves local private-key failures at both keyring entry points", async () => {
    const cases = [
      {
        failure: new DOMException("Invalid keyData", "DataError"),
        operation: () =>
          createInstallationSession(
            {
              appId: 123,
              appSlug: "holon-reviewer",
              privateKey: "invalid-private-key",
            },
            99,
            42,
          ),
      },
      {
        failure: new Error("error:1E08010C:DECODER routines::unsupported"),
        operation: () =>
          resolveRepositoryInstallation(
            {
              appId: 123,
              appSlug: "holon-reviewer",
              privateKey: "invalid-private-key",
            },
            "acme",
            "api",
          ),
      },
    ];

    for (const current of cases) {
      sdk.auth.mockRejectedValueOnce(current.failure);
      let failure: unknown;
      try {
        await current.operation();
      } catch (error) {
        failure = error;
      }

      expect(failure).toMatchObject({ name: "GitHubAppAuthenticationError" });
      expect(isAppAuthenticationError(failure)).toBe(true);
    }
  });

  it("preserves HTTP status classification during App authentication", async () => {
    for (const [status, authenticationFailure] of [
      [401, true],
      [403, false],
    ] as const) {
      sdk.auth.mockRejectedValueOnce({ status });
      let failure: unknown;
      try {
        await createInstallationSession(
          {
            appId: 123,
            appSlug: "holon-reviewer",
            privateKey: "private-key",
          },
          99,
          42,
        );
      } catch (error) {
        failure = error;
      }

      expect(failure).toMatchObject({
        name: "GitHubRequestError",
        statusCode: status,
      });
      expect(isAppAuthenticationError(failure)).toBe(authenticationFailure);
    }
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

  it("resolves the installation from repository identity through the GitHub API", async () => {
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

  it("lists check runs and parses valid items while ignoring invalid fields", async () => {
    const session = await createInstallationSession(
      { appId: 123, appSlug: "holon-reviewer", privateKey: "private-key" },
      99,
      42,
    );
    sdk.request.mockResolvedValueOnce({
      data: {
        check_runs: [
          {
            external_id: "github:42:pr:7:head:aaa",
            id: 101,
            name: "Holon Review",
            status: "in_progress",
          },
          {
            id: 102,
            name: "Other Check",
            status: "completed",
          },
        ],
        total_count: 2,
      },
    });

    const result = await session.api.listCheckRuns!("a".repeat(40), {
      check_name: "Holon Review",
      owner: "acme",
      repo: "api",
    });

    expect(result).toEqual([
      {
        externalId: "github:42:pr:7:head:aaa",
        id: 101,
        name: "Holon Review",
        status: "in_progress",
      },
      {
        id: 102,
        name: "Other Check",
        status: "completed",
      },
    ]);
  });

  it("fetches pull request refs (headSha and baseSha)", async () => {
    const session = await createInstallationSession(
      { appId: 123, appSlug: "holon-reviewer", privateKey: "private-key" },
      99,
      42,
    );
    sdk.request.mockResolvedValueOnce({
      data: {
        base: { sha: "b".repeat(40) },
        head: { sha: "a".repeat(40) },
      },
    });

    const refs = await session.currentPullRequestRefs("acme", "api", 7);
    expect(refs).toEqual({
      baseSha: "b".repeat(40),
      headSha: "a".repeat(40),
    });
  });

  describe("readRepositoryPolicyFile", () => {
    it("reads and decodes valid base64 policy file", async () => {
      const session = await createInstallationSession(
        { appId: 123, appSlug: "holon-reviewer", privateKey: "private-key" },
        99,
        42,
      );
      const yamlContent =
        'version: 1\nreview:\n  additional_excludes: ["vendor/**"]\n';
      const base64 = btoa(yamlContent);
      sdk.request.mockResolvedValueOnce({
        data: {
          content: base64,
          encoding: "base64",
          type: "file",
        },
      });

      const result = await session.readRepositoryPolicyFile!(
        "acme",
        "api",
        "b".repeat(40),
        ".github/holon.yml",
      );
      expect(result).toBeDefined();
      expect(result?.content).toBe(yamlContent);
      expect(result?.rawBytes).toBeInstanceOf(Uint8Array);
    });

    it("returns undefined when policy file is not found (404)", async () => {
      const session = await createInstallationSession(
        { appId: 123, appSlug: "holon-reviewer", privateKey: "private-key" },
        99,
        42,
      );
      sdk.request.mockRejectedValueOnce({ status: 404 });

      const result = await session.readRepositoryPolicyFile!(
        "acme",
        "api",
        "b".repeat(40),
        ".github/holon.yml",
      );
      expect(result).toBeUndefined();
    });

    it("rejects directory responses or non-file types", async () => {
      const session = await createInstallationSession(
        { appId: 123, appSlug: "holon-reviewer", privateKey: "private-key" },
        99,
        42,
      );
      sdk.request.mockResolvedValueOnce({ data: [{ name: "item" }] });
      await expect(
        session.readRepositoryPolicyFile!(
          "acme",
          "api",
          "b".repeat(40),
          ".github/holon.yml",
        ),
      ).rejects.toThrow("directory");

      sdk.request.mockResolvedValueOnce({ data: { type: "submodule" } });
      await expect(
        session.readRepositoryPolicyFile!(
          "acme",
          "api",
          "b".repeat(40),
          ".github/holon.yml",
        ),
      ).rejects.toThrow("submodule");
    });

    it("rejects unexpected encoding", async () => {
      const session = await createInstallationSession(
        { appId: 123, appSlug: "holon-reviewer", privateKey: "private-key" },
        99,
        42,
      );
      sdk.request.mockResolvedValueOnce({
        data: {
          content: "text",
          encoding: "none",
          type: "file",
        },
      });
      await expect(
        session.readRepositoryPolicyFile!(
          "acme",
          "api",
          "b".repeat(40),
          ".github/holon.yml",
        ),
      ).rejects.toThrow("Unexpected encoding");
    });

    it("rejects policy files exceeding 64 KiB", async () => {
      const session = await createInstallationSession(
        { appId: 123, appSlug: "holon-reviewer", privateKey: "private-key" },
        99,
        42,
      );
      const largeContent = "a".repeat(65_537);
      const base64 = btoa(largeContent);
      sdk.request.mockResolvedValueOnce({
        data: {
          content: base64,
          encoding: "base64",
          type: "file",
        },
      });
      await expect(
        session.readRepositoryPolicyFile!(
          "acme",
          "api",
          "b".repeat(40),
          ".github/holon.yml",
        ),
      ).rejects.toThrow("exceeds 64 KiB limit");
    });

    it("rejects policy files containing forbidden control characters", async () => {
      const session = await createInstallationSession(
        { appId: 123, appSlug: "holon-reviewer", privateKey: "private-key" },
        99,
        42,
      );
      const badContent = "version: 1\0";
      const base64 = btoa(badContent);
      sdk.request.mockResolvedValueOnce({
        data: {
          content: base64,
          encoding: "base64",
          type: "file",
        },
      });
      await expect(
        session.readRepositoryPolicyFile!(
          "acme",
          "api",
          "b".repeat(40),
          ".github/holon.yml",
        ),
      ).rejects.toThrow("forbidden control characters");
    });
  });
});
