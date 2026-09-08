import {
  githubCredentialRequestSchema,
  githubCredentialResponseSchema,
  type GitHubCredentialRequest,
  type GitHubCredentialResponse,
} from "@holon/contracts";
import {
  createInstallationSessionWithKeyring,
  type GitHubAppKeyring,
} from "@holon/github";
import { WorkerEntrypoint } from "cloudflare:workers";

import { resolveControlPlaneKeyring } from "./github-credentials.js";

const runCoordinates =
  /^github:(?<repositoryId>\d+):pr:(?<pullRequestNumber>\d+):head:(?<headSha>[a-f0-9]{40})$/u;

interface CredentialLedger {
  authorizeCredential(request: GitHubCredentialRequest): Promise<boolean>;
}

interface CredentialBrokerEnv {
  readonly GITHUB_APP_ID: string;
  readonly GITHUB_APP_PRIVATE_KEY_CURRENT?: string | undefined;
  readonly GITHUB_APP_PRIVATE_KEY_PREVIOUS?: string | undefined;
  readonly GITHUB_APP_SLUG: string;
  readonly REVIEW_LEDGERS: {
    getByName(name: string): CredentialLedger;
  };
}

interface InstallationCredential {
  readonly expiresAt: string;
  readonly token: string;
}

export type KeyringSessionFactory = (
  keyring: GitHubAppKeyring,
  installationId: number,
  repositoryId: number,
) => Promise<InstallationCredential>;

export function parseAppId(value: string): number {
  const appId = Number(value);
  if (!Number.isSafeInteger(appId) || appId <= 0) {
    throw new TypeError("GITHUB_APP_ID must be a positive integer");
  }
  return appId;
}

export function parseCredentialRequest(raw: unknown): GitHubCredentialRequest {
  const parsed = githubCredentialRequestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TypeError("Credential request is invalid");
  }
  return parsed.data;
}

function prKeyFromRequest(request: GitHubCredentialRequest): string {
  const groups = runCoordinates.exec(request.runId)?.groups;
  if (groups === undefined)
    throw new TypeError("Credential request is invalid");
  return `github:${request.repositoryId}:pr:${groups.pullRequestNumber!}`;
}

export async function issueGitHubCredential(
  env: CredentialBrokerEnv,
  rawRequest: unknown,
  createSession: KeyringSessionFactory = createInstallationSessionWithKeyring,
): Promise<GitHubCredentialResponse> {
  const request = parseCredentialRequest(rawRequest);
  const ledger = env.REVIEW_LEDGERS.getByName(prKeyFromRequest(request));
  if (!(await ledger.authorizeCredential(request))) {
    throw new Error("Credential request is not authorized");
  }
  const keyring = resolveControlPlaneKeyring(env as unknown as Cloudflare.Env);
  const session = await createSession(
    keyring,
    request.installationId,
    request.repositoryId,
  );
  return githubCredentialResponseSchema.parse({
    expiresAt: session.expiresAt,
    token: session.token,
  });
}

export class GitHubCredentialBrokerEntrypoint extends WorkerEntrypoint<CredentialBrokerEnv> {
  public getInstallationToken(
    request: GitHubCredentialRequest,
  ): Promise<GitHubCredentialResponse> {
    return issueGitHubCredential(this.env, request);
  }
}
