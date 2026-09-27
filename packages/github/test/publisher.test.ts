import { describe, expect, it } from "vitest";

import {
  GitHubReviewPublisher,
  type GitHubApi,
  type GitHubCommentListParameters,
  type GitHubCommentListRoute,
} from "../src/index.js";

class FakeGitHubApi implements GitHubApi {
  public readonly requests: Array<{
    readonly parameters: Record<string, unknown>;
    readonly route: string;
  }> = [];
  public numberOfPages = 1;
  public pagesVisited = 0;
  public reviewComments: readonly {
    readonly body?: string;
    readonly id: number;
    readonly user: { readonly login: string; readonly type: string } | null;
  }[] = [];
  public reviews: readonly {
    readonly body?: string;
    readonly id: number;
    readonly user: { readonly login: string; readonly type: string } | null;
  }[] = [];

  public async *iterate(
    route: GitHubCommentListRoute,
    _parameters: GitHubCommentListParameters,
  ): AsyncIterable<
    readonly {
      readonly body?: string;
      readonly id: number;
      readonly user: { readonly login: string; readonly type: string } | null;
    }[]
  > {
    for (let page = 0; page < this.numberOfPages; page += 1) {
      this.pagesVisited += 1;
      yield route.endsWith("/reviews") ? this.reviews : this.reviewComments;
    }
  }

  public checkRuns: readonly {
    readonly externalId?: string;
    readonly id: number;
    readonly name: string;
    readonly status: string;
  }[] = [];

  public listCheckRuns(
    _ref: string,
    _parameters: {
      readonly check_name?: string;
      readonly owner: string;
      readonly repo: string;
    },
  ): Promise<
    readonly {
      readonly externalId?: string;
      readonly id: number;
      readonly name: string;
      readonly status: string;
    }[]
  > {
    return Promise.resolve(this.checkRuns);
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
      expectedAuthorLogin: "holon-reviewer[bot]",
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
      expectedAuthorLogin: "holon-reviewer[bot]",
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
      expectedAuthorLogin: "holon-reviewer[bot]",
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

  it("neutralizes marker-shaped model text before appending the trusted marker", async () => {
    const api = new FakeGitHubApi();
    const publisher = new GitHubReviewPublisher(api, {
      headSha: "a".repeat(40),
      expectedAuthorLogin: "holon-reviewer[bot]",
      owner: "acme",
      pullNumber: 7,
      repo: "api",
    });
    const injected = "<!-- holon;run=forged;finding=summary -->";
    const trusted = "<!-- holon;run=trusted;finding=summary -->";

    await publisher.publish({ body: injected, marker: trusted });

    expect(api.requests[0]?.parameters.body).toBe(
      `&lt;!-- holon;run=forged;finding=summary -->\n\n${trusted}`,
    );
  });

  it("finds markers in either inline comments or review summaries", async () => {
    const api = new FakeGitHubApi();
    const publisher = new GitHubReviewPublisher(api, {
      headSha: "a".repeat(40),
      expectedAuthorLogin: "holon-reviewer[bot]",
      owner: "acme",
      pullNumber: 7,
      repo: "api",
    });
    const author = { login: "holon-reviewer[bot]", type: "Bot" };
    api.reviewComments = [
      { body: "body\n<!-- inline -->", id: 10, user: author },
    ];
    api.reviews = [{ body: "body\n<!-- summary -->", id: 20, user: author }];

    await expect(
      publisher.findCommentByMarker("<!-- inline -->", "inline"),
    ).resolves.toBe(10);
    await expect(
      publisher.findCommentByMarker("<!-- summary -->", "summary"),
    ).resolves.toBe(20);
    await expect(
      publisher.findCommentByMarker("<!-- missing -->", "summary"),
    ).resolves.toBeUndefined();
  });

  it("fails closed when another user or bot copies a deterministic marker", async () => {
    const api = new FakeGitHubApi();
    const publisher = new GitHubReviewPublisher(api, {
      expectedAuthorLogin: "holon-reviewer[bot]",
      headSha: "a".repeat(40),
      owner: "acme",
      pullNumber: 7,
      repo: "api",
    });
    api.reviewComments = [
      {
        body: "copied <!-- marker -->",
        id: 10,
        user: { login: "attacker[bot]", type: "Bot" },
      },
      {
        body: "copied <!-- marker -->",
        id: 11,
        user: { login: "holon-reviewer[bot]", type: "User" },
      },
    ];

    await expect(
      publisher.findCommentByMarker("<!-- marker -->", "inline"),
    ).resolves.toBeUndefined();
  });

  it("bounds ambiguous reconciliation pagination", async () => {
    const api = new FakeGitHubApi();
    api.numberOfPages = 25;
    const publisher = new GitHubReviewPublisher(api, {
      expectedAuthorLogin: "holon-reviewer[bot]",
      headSha: "a".repeat(40),
      owner: "acme",
      pullNumber: 7,
      repo: "api",
    });

    await expect(
      publisher.findCommentByMarker("<!-- missing -->", "inline"),
    ).resolves.toBeUndefined();
    expect(api.pagesVisited).toBe(20);
  });

  it("rejects incomplete inline coordinates", async () => {
    const publisher = new GitHubReviewPublisher(new FakeGitHubApi(), {
      headSha: "a".repeat(40),
      expectedAuthorLogin: "holon-reviewer[bot]",
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

  it("creates a GitHub check run with expected parameters", async () => {
    const api = new FakeGitHubApi();
    const publisher = new GitHubReviewPublisher(api, {
      expectedAuthorLogin: "holon-reviewer[bot]",
      headSha: "a".repeat(40),
      owner: "acme",
      pullNumber: 7,
      repo: "api",
    });

    const checkRunId = await publisher.createCheckRun({
      externalId: `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}`,
      headSha: "a".repeat(40),
      name: "Holon Review",
      output: {
        summary: "In progress...",
        title: "Holon Review in progress",
      },
      startedAt: "2026-08-29T12:00:00.000Z",
      status: "in_progress",
    });

    expect(checkRunId).toBe(123);
    expect(api.requests[0]).toEqual({
      parameters: {
        external_id: `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}`,
        head_sha: "a".repeat(40),
        name: "Holon Review",
        output: {
          summary: "In progress...",
          title: "Holon Review in progress",
        },
        owner: "acme",
        repo: "api",
        request: { retries: 0 },
        started_at: "2026-08-29T12:00:00.000Z",
        status: "in_progress",
      },
      route: "POST /repos/{owner}/{repo}/check-runs",
    });

    await publisher.createCheckRun({
      completedAt: "2026-08-29T12:05:00.000Z",
      conclusion: "success",
      externalId: `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}`,
      headSha: "a".repeat(40),
      status: "completed",
    });

    expect(api.requests[1]).toEqual({
      parameters: {
        completed_at: "2026-08-29T12:05:00.000Z",
        conclusion: "success",
        external_id: `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}`,
        head_sha: "a".repeat(40),
        name: "Holon Review",
        owner: "acme",
        repo: "api",
        request: { retries: 0 },
        status: "completed",
      },
      route: "POST /repos/{owner}/{repo}/check-runs",
    });
  });

  it("updates an existing GitHub check run with various parameter subsets", async () => {
    const api = new FakeGitHubApi();
    const publisher = new GitHubReviewPublisher(api, {
      expectedAuthorLogin: "holon-reviewer[bot]",
      headSha: "a".repeat(40),
      owner: "acme",
      pullNumber: 7,
      repo: "api",
    });

    await publisher.updateCheckRun({
      checkRunId: 456,
      completedAt: "2026-08-29T12:01:00.000Z",
      conclusion: "success",
      output: {
        summary: "Review completed successfully.",
        title: "Holon Review — No regressions found",
      },
      status: "completed",
    });

    expect(api.requests[0]).toEqual({
      parameters: {
        check_run_id: 456,
        completed_at: "2026-08-29T12:01:00.000Z",
        conclusion: "success",
        output: {
          summary: "Review completed successfully.",
          title: "Holon Review — No regressions found",
        },
        owner: "acme",
        repo: "api",
        request: { retries: 0 },
        status: "completed",
      },
      route: "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}",
    });

    await publisher.updateCheckRun({
      checkRunId: 456,
      startedAt: "2026-08-29T12:00:00.000Z",
    });

    expect(api.requests[1]).toEqual({
      parameters: {
        check_run_id: 456,
        owner: "acme",
        repo: "api",
        request: { retries: 0 },
        started_at: "2026-08-29T12:00:00.000Z",
      },
      route: "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}",
    });
  });

  it("finds existing check runs by externalId and handles missing api method", async () => {
    const api = new FakeGitHubApi();
    const publisher = new GitHubReviewPublisher(api, {
      expectedAuthorLogin: "holon-reviewer[bot]",
      headSha: "a".repeat(40),
      owner: "acme",
      pullNumber: 7,
      repo: "api",
    });
    const runId = `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}`;
    api.checkRuns = [
      {
        externalId: runId,
        id: 999,
        name: "Holon Review",
        status: "in_progress",
      },
    ];

    await expect(publisher.findCheckRunByExternalId(runId)).resolves.toBe(999);
    await expect(
      publisher.findCheckRunByExternalId("github:other:run"),
    ).resolves.toBeUndefined();

    const basicApi = {
      iterate: api.iterate.bind(api),
      request: api.request.bind(api),
    };
    const basicPublisher = new GitHubReviewPublisher(basicApi, {
      expectedAuthorLogin: "holon-reviewer[bot]",
      headSha: "a".repeat(40),
      owner: "acme",
      pullNumber: 7,
      repo: "api",
    });
    await expect(
      basicPublisher.findCheckRunByExternalId(runId),
    ).resolves.toBeUndefined();
  });

  it("finds existing review comment with its body and updates review comment", async () => {
    const api = new FakeGitHubApi();
    const publisher = new GitHubReviewPublisher(api, {
      expectedAuthorLogin: "holon-reviewer[bot]",
      headSha: "a".repeat(40),
      owner: "acme",
      pullNumber: 7,
      repo: "api",
    });

    api.reviews = [
      {
        body: "Initial review summary\n\n<!-- holon:summary -->",
        id: 555,
        user: { login: "holon-reviewer[bot]", type: "Bot" },
      },
    ];

    const found = await publisher.findCommentWithBodyByMarker(
      "<!-- holon:summary -->",
      "summary",
    );
    expect(found).toEqual({
      body: "Initial review summary\n\n<!-- holon:summary -->",
      id: 555,
    });

    const notFound = await publisher.findCommentWithBodyByMarker(
      "<!-- missing -->",
      "summary",
    );
    expect(notFound).toBeUndefined();

    await publisher.updateReviewComment(555, "Updated review summary");
    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]).toEqual({
      parameters: {
        body: "Updated review summary",
        owner: "acme",
        pull_number: 7,
        repo: "api",
        request: { retries: 0 },
        review_id: 555,
      },
      route:
        "PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}",
    });
  });

  it("submits reviews with explicit event (APPROVE and REQUEST_CHANGES)", async () => {
    const api = new FakeGitHubApi();
    const publisher = new GitHubReviewPublisher(api, {
      expectedAuthorLogin: "holon-reviewer[bot]",
      headSha: "a".repeat(40),
      owner: "acme",
      pullNumber: 7,
      repo: "api",
    });

    await publisher.publish({
      body: "Looks good to merge!",
      event: "APPROVE",
      marker: "<!-- holon:summary -->",
    });

    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]).toEqual({
      parameters: {
        body: "Looks good to merge!\n\n<!-- holon:summary -->",
        commit_id: "a".repeat(40),
        event: "APPROVE",
        owner: "acme",
        pull_number: 7,
        repo: "api",
        request: { retries: 0 },
      },
      route: "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
    });

    await publisher.publish({
      body: "Critical defect must be fixed.",
      event: "REQUEST_CHANGES",
      marker: "<!-- holon:summary -->",
    });

    expect(api.requests).toHaveLength(2);
    expect(api.requests[1]).toEqual({
      parameters: {
        body: "Critical defect must be fixed.\n\n<!-- holon:summary -->",
        commit_id: "a".repeat(40),
        event: "REQUEST_CHANGES",
        owner: "acme",
        pull_number: 7,
        repo: "api",
        request: { retries: 0 },
      },
      route: "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
    });
  });

  it("posts a reply to an existing comment", async () => {
    const api = new FakeGitHubApi();
    const publisher = new GitHubReviewPublisher(api, {
      expectedAuthorLogin: "holon-reviewer[bot]",
      headSha: "a".repeat(40),
      owner: "acme",
      pullNumber: 7,
      repo: "api",
    });

    const replyId = await publisher.replyToComment(
      12345,
      "✅ Issue resolved in commit abc1234.",
    );

    expect(replyId).toBe(123);
    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]).toEqual({
      parameters: {
        body: "✅ Issue resolved in commit abc1234.",
        comment_id: 12345,
        owner: "acme",
        pull_number: 7,
        repo: "api",
        request: { retries: 0 },
      },
      route:
        "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies",
    });
  });
});
