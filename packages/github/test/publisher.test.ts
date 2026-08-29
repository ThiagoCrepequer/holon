import { describe, expect, it } from "vitest";

import { GitHubReviewPublisher, type GitHubApi } from "../src/index.js";

class FakeGitHubApi implements GitHubApi {
  public readonly requests: Array<{
    readonly parameters: Record<string, unknown>;
    readonly route: string;
  }> = [];
  public reviewComments: readonly {
    readonly body?: string;
    readonly id: number;
  }[] = [];
  public reviews: readonly { readonly body?: string; readonly id: number }[] =
    [];

  public paginate(
    route: string,
    _parameters: Record<string, unknown>,
  ): Promise<readonly { readonly body?: string; readonly id: number }[]> {
    return Promise.resolve(
      route.endsWith("/reviews") ? this.reviews : this.reviewComments,
    );
  }

  public request(
    route: string,
    parameters: Record<string, unknown>,
  ): Promise<{ readonly data: { readonly id: number } }> {
    this.requests.push({ parameters, route });
    return Promise.resolve({ data: { id: 123 } });
  }
}

describe("GitHubReviewPublisher", () => {
  it("publishes inline comments using right-side line coordinates", async () => {
    const api = new FakeGitHubApi();
    const publisher = new GitHubReviewPublisher(api, {
      headSha: "a".repeat(40),
      owner: "acme",
      pullNumber: 7,
      repo: "api",
    });

    await expect(
      publisher.publish({
        body: "Problem",
        line: 10,
        marker: "<!-- marker -->",
        path: "src/index.ts",
        side: "RIGHT",
      }),
    ).resolves.toBe(123);

    expect(api.requests[0]).toEqual({
      parameters: {
        body: "Problem\n\n<!-- marker -->",
        commit_id: "a".repeat(40),
        line: 10,
        owner: "acme",
        path: "src/index.ts",
        pull_number: 7,
        repo: "api",
        request: { retries: 0 },
        side: "RIGHT",
      },
      route: "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments",
    });
  });

  it("publishes multiline comments with GitHub start coordinates", async () => {
    const api = new FakeGitHubApi();
    const publisher = new GitHubReviewPublisher(api, {
      headSha: "a".repeat(40),
      owner: "acme",
      pullNumber: 7,
      repo: "api",
    });

    await publisher.publish({
      body: "Problem",
      line: 12,
      marker: "<!-- marker -->",
      path: "src/index.ts",
      side: "RIGHT",
      startLine: 10,
    });

    expect(api.requests[0]?.parameters).toMatchObject({
      line: 12,
      side: "RIGHT",
      start_line: 10,
      start_side: "RIGHT",
    });
  });

  it("publishes the summary as one submitted pull request review", async () => {
    const api = new FakeGitHubApi();
    const publisher = new GitHubReviewPublisher(api, {
      headSha: "a".repeat(40),
      owner: "acme",
      pullNumber: 7,
      repo: "api",
    });

    await publisher.publish({ body: "Summary", marker: "<!-- marker -->" });

    expect(api.requests[0]).toMatchObject({
      parameters: {
        commit_id: "a".repeat(40),
        event: "COMMENT",
        pull_number: 7,
        request: { retries: 0 },
      },
      route: "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
    });
  });

  it("finds markers in either inline comments or review summaries", async () => {
    const api = new FakeGitHubApi();
    const publisher = new GitHubReviewPublisher(api, {
      headSha: "a".repeat(40),
      owner: "acme",
      pullNumber: 7,
      repo: "api",
    });
    api.reviewComments = [{ body: "body\n<!-- inline -->", id: 10 }];
    api.reviews = [{ body: "body\n<!-- summary -->", id: 20 }];

    await expect(
      publisher.findCommentByMarker("<!-- inline -->"),
    ).resolves.toBe(10);
    await expect(
      publisher.findCommentByMarker("<!-- summary -->"),
    ).resolves.toBe(20);
    await expect(
      publisher.findCommentByMarker("<!-- missing -->"),
    ).resolves.toBeUndefined();
  });

  it("rejects incomplete inline coordinates", async () => {
    const publisher = new GitHubReviewPublisher(new FakeGitHubApi(), {
      headSha: "a".repeat(40),
      owner: "acme",
      pullNumber: 7,
      repo: "api",
    });
    await expect(
      publisher.publish({
        body: "Problem",
        line: 10,
        marker: "<!-- marker -->",
      }),
    ).rejects.toThrow();
    await expect(
      publisher.publish({
        body: "Problem",
        line: 10,
        marker: "<!-- marker -->",
        path: "src/index.ts",
        side: "RIGHT",
        startLine: 11,
      }),
    ).rejects.toThrow("startLine");
  });
});
