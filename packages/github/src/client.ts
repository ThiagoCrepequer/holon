import { gitShaSchema } from "@holon/contracts";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/core";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";

import type { GitHubApi, GitHubComment } from "./publisher.js";

const InstallationOctokit = Octokit.plugin(paginateRest, retry, throttling);

export interface GitHubAppCredentials {
  readonly appId: number;
  readonly privateKey: string;
}

export interface GitHubInstallationSession {
  readonly api: GitHubApi;
  currentHeadSha(
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<string>;
  readonly expiresAt: string;
  readonly token: string;
}

class OctokitApi implements GitHubApi {
  public constructor(
    private readonly octokit: InstanceType<typeof InstallationOctokit>,
  ) {}

  public async paginate(
    route: string,
    parameters: Record<string, unknown>,
  ): Promise<readonly GitHubComment[]> {
    const data = await this.octokit.paginate(route, parameters);
    return data as readonly GitHubComment[];
  }

  public async request(
    route: string,
    parameters: Record<string, unknown>,
  ): Promise<{ readonly data: { readonly id: number } }> {
    const response = await this.octokit.request(route, parameters);
    return response as { readonly data: { readonly id: number } };
  }
}

export async function createInstallationSession(
  credentials: GitHubAppCredentials,
  installationId: number,
): Promise<GitHubInstallationSession> {
  const auth = createAppAuth({
    appId: credentials.appId,
    privateKey: credentials.privateKey,
  });
  const authentication = await auth({ installationId, type: "installation" });
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
      const response = await octokit.request(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}",
        {
          owner,
          pull_number: pullNumber,
          repo,
        },
      );
      return gitShaSchema.parse(response.data.head.sha);
    },
    expiresAt: authentication.expiresAt,
    token: authentication.token,
  };
}
