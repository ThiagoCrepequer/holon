import type { PublishCommentInput, ReviewPublisher } from "@holon/application";

export interface GitHubComment {
  readonly body?: string | undefined;
  readonly id: number;
}

export interface GitHubApi {
  paginate(
    route: string,
    parameters: Record<string, unknown>,
  ): Promise<readonly GitHubComment[]>;
  request(
    route: string,
    parameters: Record<string, unknown>,
  ): Promise<{ readonly data: { readonly id: number } }>;
}

export interface PullRequestTarget {
  readonly headSha: string;
  readonly owner: string;
  readonly pullNumber: number;
  readonly repo: string;
}

function withMarker(body: string, marker: string): string {
  return `${body}\n\n${marker}`;
}

export class GitHubReviewPublisher implements ReviewPublisher {
  public constructor(
    private readonly api: GitHubApi,
    private readonly target: PullRequestTarget,
  ) {}

  public async findCommentByMarker(
    marker: string,
  ): Promise<number | undefined> {
    const common = {
      owner: this.target.owner,
      per_page: 100,
      repo: this.target.repo,
    };
    const [reviewComments, reviews] = await Promise.all([
      this.api.paginate(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}/comments",
        {
          ...common,
          pull_number: this.target.pullNumber,
        },
      ),
      this.api.paginate(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
        {
          ...common,
          pull_number: this.target.pullNumber,
        },
      ),
    ]);
    return [...reviewComments, ...reviews].find(
      (comment) => comment.body?.includes(marker) === true,
    )?.id;
  }

  public async publish(input: PublishCommentInput): Promise<number> {
    const body = withMarker(input.body, input.marker);
    if (
      input.line === undefined &&
      input.path === undefined &&
      input.side === undefined &&
      input.startLine === undefined
    ) {
      const response = await this.api.request(
        "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
        {
          body,
          commit_id: this.target.headSha,
          event: "COMMENT",
          owner: this.target.owner,
          pull_number: this.target.pullNumber,
          repo: this.target.repo,
          request: { retries: 0 },
        },
      );
      return response.data.id;
    }
    if (
      input.line === undefined ||
      input.path === undefined ||
      input.side === undefined
    ) {
      throw new TypeError("Inline publication requires path, line and side");
    }
    if (input.startLine !== undefined && input.startLine > input.line) {
      throw new TypeError("Inline publication startLine must not follow line");
    }
    const range =
      input.startLine === undefined || input.startLine === input.line
        ? {}
        : { start_line: input.startLine, start_side: input.side };
    const response = await this.api.request(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments",
      {
        body,
        commit_id: this.target.headSha,
        line: input.line,
        owner: this.target.owner,
        path: input.path,
        pull_number: this.target.pullNumber,
        repo: this.target.repo,
        request: { retries: 0 },
        side: input.side,
        ...range,
      },
    );
    return response.data.id;
  }
}
