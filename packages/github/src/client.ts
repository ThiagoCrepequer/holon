import type { ConfigurationSnapshotReader } from "@holon/application";
import { gitShaSchema } from "@holon/contracts";
import { Octokit } from "@octokit/core";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";

import { readArtifactBody } from "./artifact-body.js";
import { createDiagnosticAppAuth } from "./authentication.js";
import { readConfigurationJson } from "./configuration-json.js";
import { createConfigurationSnapshotReader } from "./configuration-reader.js";
import {
  classifyGitHubRequestError,
  executeGitHubAppAuthenticationRequest,
  executeGitHubRequest,
  GitHubDiffTooLargeError,
  GitHubConfigurationError,
} from "./errors.js";
import type {
  GitHubApi,
  GitHubCheckRun,
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

export interface GitHubWorkflowArtifact {
  readonly archiveDownloadUrl?: string | undefined;
  readonly id: number;
  readonly name: string;
  readonly sizeInBytes: number;
}

export interface GitHubInstallationSession {
  configurationReader(
    owner: string,
    repo: string,
    baseSha: string,
  ): ConfigurationSnapshotReader;
  readonly api: GitHubApi;
  currentHeadSha(
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<string>;
  currentPullRequestRefs(
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<{ readonly baseSha: string; readonly headSha: string }>;
  downloadArtifactZip?(
    owner: string,
    repo: string,
    artifactId: number,
  ): Promise<ArrayBuffer>;
  readonly expectedAuthorLogin: string;
  readonly expiresAt: string;
  listWorkflowRunArtifacts?(
    owner: string,
    repo: string,
    runId: number,
  ): Promise<readonly GitHubWorkflowArtifact[]>;
  pullRequestDiff(
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<string>;
  repositoryPermission?(
    owner: string,
    repo: string,
    username: string,
  ): Promise<string>;
  readonly token: string;
}

export async function resolveRepositoryInstallation(
  credentials: GitHubAppCredentials,
  owner: string,
  repo: string,
): Promise<number> {
  const auth = await createDiagnosticAppAuth(credentials);
  const authentication = await executeGitHubAppAuthenticationRequest(
    () => auth({ type: "app" }),
    "app_auth",
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

  public async listCheckRuns(
    ref: string,
    parameters: {
      readonly check_name?: string;
      readonly owner: string;
      readonly repo: string;
    },
  ): Promise<readonly GitHubCheckRun[]> {
    return await executeGitHubRequest(async () => {
      const response = await this.octokit.request(
        "GET /repos/{owner}/{repo}/commits/{ref}/check-runs",
        {
          ...parameters,
          ref,
        },
      );
      const data = record(response.data, "GitHub check runs list data");
      const checkRuns = Array.isArray(data.check_runs) ? data.check_runs : [];
      return checkRuns.map((candidate) => {
        const item = record(candidate, "GitHub check run item");
        if (!Number.isSafeInteger(item.id) || Number(item.id) <= 0) {
          throw new TypeError("GitHub check run id must be a positive integer");
        }
        return {
          ...(typeof item.external_id === "string"
            ? { externalId: item.external_id }
            : {}),
          id: Number(item.id),
          name: typeof item.name === "string" ? item.name : "",
          status: typeof item.status === "string" ? item.status : "",
        };
      });
    });
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
    throw new GitHubConfigurationError("github_app_slug_invalid");
  }
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
    throw new TypeError("repositoryId must be a positive safe integer");
  }
  const auth = await createDiagnosticAppAuth(credentials);
  const authentication = await executeGitHubAppAuthenticationRequest(
    () =>
      auth({
        installationId,
        repositoryIds: [repositoryId],
        type: "installation",
      }),
    "installation_auth",
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
    async currentPullRequestRefs(owner, repo, pullNumber) {
      return await executeGitHubRequest(async () => {
        const response = await octokit.request(
          "GET /repos/{owner}/{repo}/pulls/{pull_number}",
          {
            owner,
            pull_number: pullNumber,
            repo,
          },
        );
        return {
          baseSha: gitShaSchema.parse(response.data.base.sha),
          headSha: gitShaSchema.parse(response.data.head.sha),
        };
      }, "pull_request_refs");
    },
    configurationReader(owner, repo, baseSha) {
      return createConfigurationSnapshotReader(
        {
          request: async (route, parameters, maximumBytes) => {
            const response = await octokit.request(route, {
              ...parameters,
              request: {
                parseSuccessResponseBody: false,
                retries: 0,
                signal: AbortSignal.timeout(30_000),
              },
            });
            return {
              data: await readConfigurationJson(response.data, maximumBytes),
            };
          },
        },
        owner,
        repo,
        baseSha,
      );
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
    async repositoryPermission(owner, repo, username) {
      return await executeGitHubRequest(async () => {
        const response = await octokit.request(
          "GET /repos/{owner}/{repo}/collaborators/{username}/permission",
          { owner, repo, username },
        );
        const data = record(
          response.data,
          "GitHub repository permission response",
        );
        if (typeof data.permission !== "string") {
          throw new TypeError(
            "GitHub repository permission response.permission must be text",
          );
        }
        return data.permission;
      });
    },
    async listWorkflowRunArtifacts(owner, repo, runId) {
      return await executeGitHubRequest(async () => {
        const response = await octokit.request(
          "GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts",
          {
            owner,
            repo,
            run_id: runId,
          },
        );
        const data = record(response.data, "GitHub artifacts response");
        const artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
        return artifacts.map((candidate) => {
          const item = record(candidate, "GitHub artifact item");
          return {
            archiveDownloadUrl:
              typeof item.archive_download_url === "string"
                ? item.archive_download_url
                : undefined,
            id: Number(item.id),
            name: typeof item.name === "string" ? item.name : "",
            sizeInBytes: Number(item.size_in_bytes ?? 0),
          };
        });
      });
    },
    async downloadArtifactZip(owner, repo, artifactId) {
      return await executeGitHubRequest(async () => {
        const response = await octokit.request(
          "GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}",
          {
            archive_format: "zip",
            artifact_id: artifactId,
            owner,
            repo,
            request: {
              parseSuccessResponseBody: false,
            },
          },
        );
        return await readArtifactBody(response.data, response.headers);
      });
    },
    expiresAt: authentication.expiresAt,
    expectedAuthorLogin: `${credentials.appSlug}[bot]`,
    token: authentication.token,
  };
}
