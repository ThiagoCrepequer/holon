import { GitHubRequestError } from "@holon/github";
import { NonRetryableError } from "cloudflare:workflows";
import { describe, expect, it } from "vitest";

import {
  executeGitHubOperation,
  GitHubTransientError,
  githubRetryDelay,
} from "../src/github-operations.js";

describe("GitHub operation diagnostics", () => {
  it("reports the typed original error before mapping it to a Workflow error", async () => {
    const entries: Array<{
      event: string;
      code: string | undefined;
      operation: string | undefined;
    }> = [];
    const error = new GitHubRequestError("invalid_response", false);
    await expect(
      executeGitHubOperation(() => Promise.reject(error), Date.now, {
        context: { operation: "github.create_installation_session" },
        reporter: {
          report: (event, original, context) =>
            entries.push({
              event,
              code:
                original instanceof GitHubRequestError
                  ? original.code
                  : undefined,
              operation: context?.operation,
            }),
        },
      }),
    ).rejects.toMatchObject({
      message: "HOLON_GITHUB_NON_RETRYABLE:invalid_response",
    });
    expect(entries).toEqual([
      {
        event: "github.operation_failed",
        code: "invalid_response",
        operation: "github.create_installation_session",
      },
    ]);
  });
});

describe("GitHub operation policy", () => {
  it("preserves the typed GitHub adapter classification and retry delay", async () => {
    await expect(
      executeGitHubOperation(() =>
        Promise.reject(
          new GitHubRequestError("rate_limited", true, 429, 12_000),
        ),
      ),
    ).rejects.toMatchObject({
      message: "HOLON_GITHUB_TRANSIENT:rate-limit",
      name: "GitHubTransientError",
      retryAfterMs: 12_000,
    });
    await expect(
      executeGitHubOperation(() =>
        Promise.reject(
          new GitHubRequestError("upstream_permanent", false, 404),
        ),
      ),
    ).rejects.toMatchObject({
      message: "HOLON_GITHUB_NON_RETRYABLE:upstream_permanent",
      name: "NonRetryableError",
    });
    await expect(
      executeGitHubOperation(() =>
        Promise.reject(new GitHubRequestError("upstream_transient", true, 503)),
      ),
    ).rejects.toMatchObject({ message: "HOLON_GITHUB_TRANSIENT:server" });
    await expect(
      executeGitHubOperation(() =>
        Promise.reject(new GitHubRequestError("network_transient", true)),
      ),
    ).rejects.toMatchObject({ message: "HOLON_GITHUB_TRANSIENT:transport" });
    await expect(
      executeGitHubOperation(() =>
        Promise.reject(new GitHubRequestError("invalid_response", false)),
      ),
    ).rejects.toMatchObject({
      message: "HOLON_GITHUB_NON_RETRYABLE:invalid_response",
    });
  });

  it("does not reclassify an already normalized workflow error", async () => {
    const transient = new GitHubTransientError("server");
    await expect(
      executeGitHubOperation(() => Promise.reject(transient)),
    ).rejects.toBe(transient);
    const permanent = new NonRetryableError("safe");
    await expect(
      executeGitHubOperation(() => Promise.reject(permanent)),
    ).rejects.toBe(permanent);
  });

  it("honors Retry-After for 403 and 429 rate limiting", async () => {
    for (const status of [403, 429]) {
      await expect(
        executeGitHubOperation(
          () =>
            Promise.reject({
              response: { headers: { "retry-after": "12" } },
              status,
            }),
          () => 1_000,
        ),
      ).rejects.toMatchObject({
        name: "GitHubTransientError",
        retryAfterMs: 12_000,
      });
    }
  });

  it("uses the primary-rate reset and classifies permanent 4xx", async () => {
    await expect(
      executeGitHubOperation(
        () =>
          Promise.reject({
            response: {
              headers: {
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": "20",
              },
            },
            status: 403,
          }),
        () => 10_000,
      ),
    ).rejects.toMatchObject({ retryAfterMs: 10_000 });
    await expect(
      executeGitHubOperation(() => Promise.reject({ status: 422 })),
    ).rejects.toMatchObject({
      message: "HOLON_GITHUB_NON_RETRYABLE:422",
      name: "NonRetryableError",
    });
    await expect(
      executeGitHubOperation(() =>
        Promise.reject({
          response: { headers: new Headers({ "retry-after": "0" }) },
          status: 429,
        }),
      ),
    ).rejects.toMatchObject({ retryAfterMs: 1_000 });
    await expect(
      executeGitHubOperation(() =>
        Promise.reject({
          response: {
            headers: {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": "9999999999",
            },
          },
          status: 403,
        }),
      ),
    ).rejects.toMatchObject({ retryAfterMs: 300_000 });
  });

  it("classifies 5xx and transport failures as sanitized retryable errors", async () => {
    await expect(
      executeGitHubOperation(() => Promise.reject({ status: 503 })),
    ).rejects.toMatchObject({ name: "GitHubTransientError" });
    for (const status of [408, 409]) {
      await expect(
        executeGitHubOperation(() => Promise.reject({ status })),
      ).rejects.toMatchObject({ message: "HOLON_GITHUB_TRANSIENT:server" });
    }
    await expect(
      executeGitHubOperation(() =>
        Promise.reject(new Error("secret-bearing transport failure")),
      ),
    ).rejects.toMatchObject({
      message: "HOLON_GITHUB_TRANSIENT:transport",
      name: "GitHubTransientError",
    });
    await expect(
      executeGitHubOperation(() => Promise.reject(new TypeError("bad shape"))),
    ).rejects.toMatchObject({
      message: "HOLON_GITHUB_NON_RETRYABLE:response",
    });
    await expect(
      executeGitHubOperation(() =>
        Promise.reject(
          Object.assign(new Error(), { name: "GitHubDiffTooLargeError" }),
        ),
      ),
    ).rejects.toMatchObject({
      message: "HOLON_GITHUB_NON_RETRYABLE:response",
    });
  });

  it("feeds provider delays into the bounded Workflow retry policy", () => {
    expect(
      githubRetryDelay({
        ctx: { attempt: 2 },
        error: Object.assign(new Error(), { retryAfterMs: 45_000 }),
      }),
    ).toBe(45_000);
    expect(githubRetryDelay({ ctx: { attempt: 20 }, error: new Error() })).toBe(
      60_000,
    );
    expect(githubRetryDelay({ attempt: 2, error: null })).toBe(10_000);
    expect(
      githubRetryDelay({
        error: Object.assign(new Error(), { retryAfterMs: 0 }),
      }),
    ).toBe(1_000);
  });
});
