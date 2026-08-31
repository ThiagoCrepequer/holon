import { describe, expect, it } from "vitest";

import {
  GitHubRequestError,
  classifyGitHubRequestError,
} from "../src/index.js";

describe("GitHub request error classification", () => {
  it("honors Retry-After for primary or secondary rate limits", () => {
    expect(
      classifyGitHubRequestError({
        response: { headers: { "retry-after": "12" } },
        status: 429,
      }),
    ).toMatchObject({
      code: "rate_limited",
      retryAfterMs: 12_000,
      retryable: true,
      statusCode: 429,
    });
  });

  it("derives a bounded delay from x-ratelimit-reset", () => {
    expect(
      classifyGitHubRequestError(
        {
          response: {
            headers: {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": "1006",
            },
          },
          status: 403,
        },
        1_000_000,
      ),
    ).toMatchObject({ code: "rate_limited", retryAfterMs: 6_000 });
  });

  it.each([500, 502, 503, 504])(
    "classifies GitHub %s as transient",
    (status) => {
      expect(classifyGitHubRequestError({ status })).toMatchObject({
        code: "upstream_transient",
        retryable: true,
        statusCode: status,
      });
    },
  );

  it.each([401, 403, 404, 422])(
    "classifies non-rate-limit GitHub %s as permanent",
    (status) => {
      expect(classifyGitHubRequestError({ status })).toMatchObject({
        code: "upstream_permanent",
        retryable: false,
        statusCode: status,
      });
    },
  );

  it("preserves an already classified safe error", () => {
    const error = new GitHubRequestError("upstream_transient", true, 503);
    expect(classifyGitHubRequestError(error)).toBe(error);
  });

  it("retries a known Octokit transport error but not arbitrary parser failures", () => {
    const transport = new Error("socket closed");
    transport.name = "RequestError";
    expect(classifyGitHubRequestError(transport)).toMatchObject({
      code: "network_transient",
      retryable: true,
    });
    const parser = new Error("unexpected shape");
    parser.name = "ZodError";
    expect(classifyGitHubRequestError(parser)).toMatchObject({
      code: "invalid_response",
      retryable: false,
    });
  });
});
