import type {
  CreateCheckRunInput,
  PublishCommentInput,
  PublicationMarkerLookup,
  ReviewPublisher,
  UpdateCheckRunInput,
} from "@holon/application";

export interface GitHubComment {
  readonly body?: string | undefined;
  readonly id: number;
  readonly user: {
    readonly login: string;
    readonly type: string;
  } | null;
}

export interface GitHubCheckRun {
  readonly externalId?: string | undefined;
  readonly id: number;
  readonly name: string;
  readonly status: string;
}

export type GitHubCommentListRoute =
  | "GET /repos/{owner}/{repo}/pulls/{pull_number}/comments"
  | "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews"
  | "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/comments";

export interface GitHubCommentListParameters {
  readonly owner: string;
  readonly per_page: number;
  readonly pull_number: number;
  readonly repo: string;
  readonly review_id?: number | undefined;
}

export interface GitHubApi {
  iterate(
    route: GitHubCommentListRoute,
    parameters: GitHubCommentListParameters,
  ): AsyncIterable<readonly GitHubComment[]>;
  listCheckRuns?(
    ref: string,
    parameters: {
      readonly check_name?: string;
      readonly owner: string;
      readonly repo: string;
    },
  ): Promise<readonly GitHubCheckRun[]>;
  request(
    route: string,
    parameters: Record<string, unknown>,
  ): Promise<{ readonly data: { readonly id: number } }>;
}

export interface PullRequestTarget {
  readonly expectedAuthorLogin: string;
  readonly headSha: string;
  readonly owner: string;
  readonly pullNumber: number;
  readonly repo: string;
}

function withMarker(body: string, marker: string): string {
  const safeBody = body.replaceAll("<!-- holon;", "&lt;!-- holon;");
  return `${safeBody}\n\n${marker}`;
}

export class GitHubReviewPublisher implements ReviewPublisher {
  public constructor(
    private readonly api: GitHubApi,
    private readonly target: PullRequestTarget,
  ) {
    if (!/^[A-Za-z0-9-]+\[bot\]$/u.test(target.expectedAuthorLogin)) {
      throw new TypeError("expectedAuthorLogin must identify a GitHub App bot");
    }
  }

  public async findCommentByMarker(
    marker: string,
    kind: "inline" | "summary",
  ): Promise<PublicationMarkerLookup> {
    const route =
      kind === "summary"
        ? "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews"
        : "GET /repos/{owner}/{repo}/pulls/{pull_number}/comments";
    const common = {
      owner: this.target.owner,
      per_page: 100,
      pull_number: this.target.pullNumber,
      repo: this.target.repo,
    };
    let pages = 0;
    for await (const page of this.api.iterate(route, common)) {
      pages += 1;
      const match = page.find(
        (comment) =>
          comment.user?.type === "Bot" &&
          comment.user.login === this.target.expectedAuthorLogin &&
          comment.body?.includes(marker) === true,
      );
      if (match?.body !== undefined)
        return { status: "found", id: match.id, body: match.body };
      if (pages >= 20) return { status: "inconclusive", reason: "page_limit" };
    }
    return { status: "absent" };
  }

  public async findReviewCommentsByMarkers(
    reviewId: number,
    markers: readonly string[],
  ): Promise<ReadonlyMap<string, number>> {
    const remaining = new Set(markers);
    const matches = new Map<string, number>();
    let pages = 0;
    for await (const page of this.api.iterate(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/comments",
      {
        owner: this.target.owner,
        per_page: 100,
        pull_number: this.target.pullNumber,
        repo: this.target.repo,
        review_id: reviewId,
      },
    )) {
      pages++;
      for (const comment of page) {
        if (
          comment.user?.type !== "Bot" ||
          comment.user.login !== this.target.expectedAuthorLogin
        )
          continue;
        for (const marker of remaining) {
          if (comment.body?.includes(marker) !== true) continue;
          matches.set(marker, comment.id);
          remaining.delete(marker);
        }
      }
      if (remaining.size === 0 || pages >= 20) break;
    }
    return matches;
  }

  public async findCheckRunByExternalId(
    externalId: string,
  ): Promise<number | undefined> {
    if (this.api.listCheckRuns === undefined) return undefined;
    const checkRuns = await this.api.listCheckRuns(this.target.headSha, {
      check_name: "Holon Review",
      owner: this.target.owner,
      repo: this.target.repo,
    });
    const match = checkRuns.find((item) => item.externalId === externalId);
    return match?.id;
  }

  public async createCheckRun(input: CreateCheckRunInput): Promise<number> {
    const parameters: Record<string, unknown> = {
      external_id: input.externalId,
      head_sha: input.headSha,
      name: input.name ?? "Holon Review",
      owner: this.target.owner,
      repo: this.target.repo,
      request: { retries: 0 },
      status: input.status,
      ...(input.startedAt === undefined ? {} : { started_at: input.startedAt }),
      ...(input.completedAt === undefined
        ? {}
        : { completed_at: input.completedAt }),
      ...(input.conclusion === undefined
        ? {}
        : { conclusion: input.conclusion }),
      ...(input.output === undefined ? {} : { output: input.output }),
    };
    const response = await this.api.request(
      "POST /repos/{owner}/{repo}/check-runs",
      parameters,
    );
    return response.data.id;
  }

  public async updateCheckRun(input: UpdateCheckRunInput): Promise<void> {
    const parameters: Record<string, unknown> = {
      check_run_id: input.checkRunId,
      owner: this.target.owner,
      repo: this.target.repo,
      request: { retries: 0 },
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.conclusion === undefined
        ? {}
        : { conclusion: input.conclusion }),
      ...(input.startedAt === undefined ? {} : { started_at: input.startedAt }),
      ...(input.completedAt === undefined
        ? {}
        : { completed_at: input.completedAt }),
      ...(input.output === undefined ? {} : { output: input.output }),
    };
    await this.api.request(
      "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}",
      parameters,
    );
  }

  public async updateReviewComment(
    reviewId: number,
    body: string,
  ): Promise<void> {
    await this.api.request(
      "PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}",
      {
        body,
        owner: this.target.owner,
        pull_number: this.target.pullNumber,
        repo: this.target.repo,
        request: { retries: 0 },
        review_id: reviewId,
      },
    );
  }

  public async publish(input: PublishCommentInput): Promise<number> {
    const body = withMarker(input.body, input.marker);
    const comments = input.comments?.map((comment) => {
      if (comment.startLine !== undefined && comment.startLine > comment.line) {
        throw new TypeError(
          "Inline publication startLine must not follow line",
        );
      }
      return {
        body: withMarker(comment.body, comment.marker),
        line: comment.line,
        path: comment.path,
        side: comment.side,
        ...(comment.startLine === undefined ||
        comment.startLine === comment.line
          ? {}
          : { start_line: comment.startLine, start_side: comment.side }),
      };
    });
    const response = await this.api.request(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
      {
        body,
        commit_id: this.target.headSha,
        event: input.event ?? "COMMENT",
        owner: this.target.owner,
        pull_number: this.target.pullNumber,
        repo: this.target.repo,
        request: { retries: 0 },
        ...(comments === undefined ? {} : { comments }),
      },
    );
    return response.data.id;
  }

  public async replyToComment(
    commentId: number,
    body: string,
  ): Promise<number> {
    const response = await this.api.request(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies",
      {
        body,
        comment_id: commentId,
        owner: this.target.owner,
        pull_number: this.target.pullNumber,
        repo: this.target.repo,
        request: { retries: 0 },
      },
    );
    return response.data.id;
  }
}
