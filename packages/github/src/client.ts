import { gitShaSchema } from "@holon/contracts";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/core";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";

import {
  classifyGitHubRequestError,
  executeGitHubRequest,
  GitHubDiffTooLargeError,
} from "./errors.js";
import type {
  GitHubApi,
  GitHubComment,
  GitHubCommentListParameters,
  GitHubCommentListRoute,
} from "./publisher.js";

const InstallationOctokit = Octokit.plugin(paginateRest, retry, throttling);

export interface GitHubAppCredentials {
  readonly appId: number;
  readonly appSlug: string;
  readonly privateKey: string;
}

export interface GitHubInstallationSession {
  readonly api: GitHubApi;
  currentHeadSha(
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<string>;
  pullRequestDiff(
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<string>;
  readonly expiresAt: string;
  readonly expectedAuthorLogin: string;
  readonly token: string;
}

export async function resolveRepositoryInstallation(
  credentials: GitHubAppCredentials,
  owner: string,
  repo: string,
): Promise<number> {
  const auth = createAppAuth({
    appId: credentials.appId,
    privateKey: credentials.privateKey,
  });
  const authentication = await executeGitHubRequest(() =>
    auth({ type: "app" }),
  );
  const octokit = new Octokit({ auth: authentication.token });
  return await executeGitHubRequest(async () => {
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/installation",
      { owner, repo },
    );
    const data = record(response.data, "GitHub installation response");
    if (!Number.isSafeInteger(data.id) || Number(data.id) <= 0) {
      throw new TypeError("GitHub installation response.id must be positive");
    }
    return Number(data.id);
  });
}

class OctokitApi implements GitHubApi {
  public constructor(
    private readonly octokit: InstanceType<typeof InstallationOctokit>,
  ) {}

  public async *iterate(
    route: GitHubCommentListRoute,
    parameters: GitHubCommentListParameters,
  ): AsyncIterable<readonly GitHubComment[]> {
    try {
      const responses =
        route === "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews"
          ? this.octokit.paginate.iterator(
              "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
              parameters,
            )
          : this.octokit.paginate.iterator(
              "GET /repos/{owner}/{repo}/pulls/{pull_number}/comments",
              parameters,
            );
      for await (const response of responses) {
        yield parseGitHubComments(response.data);
      }
    } catch (error) {
      throw classifyGitHubRequestError(error);
    }
  }

  public async request(
    route: string,
    parameters: Record<string, unknown>,
  ): Promise<{ readonly data: { readonly id: number } }> {
    return await executeGitHubRequest(async () => {
      const response = await this.octokit.request(route, parameters);
      const data = record(response.data, "GitHub response data");
      if (!Number.isSafeInteger(data.id) || Number(data.id) <= 0) {
        throw new TypeError(
          "GitHub response data.id must be a positive integer",
        );
      }
      return { data: { id: Number(data.id) } };
    });
  }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseGitHubComments(value: unknown): readonly GitHubComment[] {
  if (!Array.isArray(value)) {
    throw new TypeError("GitHub comment page must be an array");
  }
  return value.map((candidate) => {
    const comment = record(candidate, "GitHub comment");
    if (!Number.isSafeInteger(comment.id) || Number(comment.id) <= 0) {
      throw new TypeError("GitHub comment.id must be a positive integer");
    }
    if (comment.body !== undefined && typeof comment.body !== "string") {
      throw new TypeError("GitHub comment.body must be text when present");
    }
    const user =
      comment.user === null
        ? null
        : record(comment.user, "GitHub comment.user");
    if (
      user !== null &&
      (typeof user.login !== "string" || typeof user.type !== "string")
    ) {
      throw new TypeError(
        "GitHub comment.user must identify its login and type",
      );
    }
    return {
      ...(comment.body === undefined ? {} : { body: comment.body }),
      id: Number(comment.id),
      user:
        user === null
          ? null
          : { login: String(user.login), type: String(user.type) },
    };
  });
}

export async function createInstallationSession(
  credentials: GitHubAppCredentials,
  installationId: number,
  repositoryId: number,
): Promise<GitHubInstallationSession> {
  if (!/^[A-Za-z0-9-]+$/u.test(credentials.appSlug)) {
    throw new TypeError("GitHub App slug must use GitHub slug characters");
  }
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
    throw new TypeError("repositoryId must be a positive safe integer");
  }
  const auth = createAppAuth({
    appId: credentials.appId,
    privateKey: credentials.privateKey,
  });
  const authentication = await executeGitHubRequest(() =>
    auth({
      installationId,
      repositoryIds: [repositoryId],
      type: "installation",
    }),
  );
  const octokit = new InstallationOctokit({
    auth: authentication.token,
    throttle: {
      onRateLimit: () => undefined,
      onSecondaryRateLimit: () => undefined,
    },
  });
  return {
    api: new OctokitApi(octokit),
    async currentHeadSha(owner, repo, pullNumber) {
      return await executeGitHubRequest(async () => {
        const response = await octokit.request(
          "GET /repos/{owner}/{repo}/pulls/{pull_number}",
          {
            owner,
            pull_number: pullNumber,
            repo,
          },
        );
        return gitShaSchema.parse(response.data.head.sha);
      });
    },
    async pullRequestDiff(owner, repo, pullNumber) {
      return await executeGitHubRequest(async () => {
        const response = await octokit.request(
          "GET /repos/{owner}/{repo}/pulls/{pull_number}",
          {
            mediaType: { format: "diff" },
            owner,
            pull_number: pullNumber,
            repo,
          },
        );
        if (typeof response.data !== "string") {
          throw new TypeError("GitHub pull request diff response was not text");
        }
        if (new TextEncoder().encode(response.data).byteLength > 2_000_000) {
          throw new GitHubDiffTooLargeError();
        }
        return response.data;
      });
    },
    expiresAt: authentication.expiresAt,
    expectedAuthorLogin: `${credentials.appSlug}[bot]`,
    token: authentication.token,
  };
}
