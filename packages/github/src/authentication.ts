import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/core";
import githubAppJwt from "universal-github-app-jwt";

import type { GitHubAppCredentials } from "./client.js";
import {
  executeGitHubAppAuthenticationRequest,
  executeGitHubRequest,
} from "./errors.js";

/** Keep SDK caching and clock correction while identifying the failing boundary. */
export async function createDiagnosticAppAuth(
  credentials: GitHubAppCredentials,
) {
  return await executeGitHubAppAuthenticationRequest(async () => {
    const transport = new Octokit();
    transport.hook.wrap("request", async (request, options) => {
      const response = await executeGitHubRequest(
        async () => await request(options),
        "installation_token_request",
      );
      return await executeGitHubRequest(async () => {
        const data = response.data as {
          token?: unknown;
          expires_at?: unknown;
        } | null;
        if (
          !data ||
          typeof data.token !== "string" ||
          !data.token ||
          typeof data.expires_at !== "string" ||
          !Number.isFinite(Date.parse(data.expires_at))
        ) {
          throw new TypeError("Installation token response contract failed");
        }
        return response;
      }, "installation_token_response");
    });
    return createAppAuth({
      appId: credentials.appId,
      request: transport.request,
      createJwt: async (appId, timeDifference) => {
        const result = await executeGitHubAppAuthenticationRequest(
          () =>
            githubAppJwt({
              id: appId,
              privateKey: credentials.privateKey,
              now: Math.floor(Date.now() / 1000) + (timeDifference ?? 0),
            }),
          "jwt_signing",
        );
        return {
          jwt: result.token,
          expiresAt: new Date(result.expiration * 1000).toISOString(),
        };
      },
    });
  }, "auth_configuration");
}
