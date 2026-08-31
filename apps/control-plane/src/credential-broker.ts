import {
  githubCredentialRequestSchema,
  githubCredentialResponseSchema,
  type GitHubCredentialRequest,
  type GitHubCredentialResponse,
} from "@holon/contracts";
import {
  createInstallationSession,
  resolveRepositoryInstallation,
} from "@holon/github";
import { WorkerEntrypoint } from "cloudflare:workers";

const maximumSandboxIdLength = 63;
const runCoordinates =
  /^github:(?<repositoryId>\d+):pr:(?<pullRequestNumber>\d+):head:(?<headSha>[a-f0-9]{40})$/u;

interface CredentialLedger {
  authorizeCredential(request: GitHubCredentialRequest): Promise<boolean>;
  bootstrapCredentialScope(request: GitHubCredentialRequest): Promise<boolean>;
  canBootstrapCredentialScope(
    request: GitHubCredentialRequest,
  ): Promise<boolean>;
}

interface CredentialBrokerEnv {
  readonly GITHUB_APP_ID: string;
  readonly GITHUB_APP_PRIVATE_KEY: string;
  readonly GITHUB_APP_SLUG: string;
  readonly REVIEW_LEDGERS: {
    getByName(name: string): CredentialLedger;
  };
}

interface InstallationCredential {
  readonly expiresAt: string;
  readonly token: string;
}

type SessionFactory = (
  credentials: {
    readonly appId: number;
    readonly appSlug: string;
    readonly privateKey: string;
  },
  installationId: number,
  repositoryId: number,
) => Promise<InstallationCredential>;

type InstallationResolver = (
  credentials: {
    readonly appId: number;
    readonly appSlug: string;
    readonly privateKey: string;
  },
  owner: string,
  repository: string,
) => Promise<number>;

export class CredentialRepositoryNotInstalledError extends Error {
  public constructor() {
    super("Credential repository is not installed for this GitHub App");
    this.name = "CredentialRepositoryNotInstalledError";
  }
}

export function parseAppId(value: string): number {
  const appId = Number(value);
  if (!Number.isSafeInteger(appId) || appId <= 0) {
    throw new TypeError("GITHUB_APP_ID must be a positive integer");
  }
  return appId;
}

function compactCoordinate(value: string): string {
  const coordinate = BigInt(value);
  if (coordinate <= 0n || coordinate > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError("Credential request is invalid");
  }
  return coordinate.toString(36);
}

export function createExpectedContainerId(runId: string): string {
  const groups = runCoordinates.exec(runId)?.groups;
  if (groups === undefined)
    throw new TypeError("Credential request is invalid");
  const repositoryId = compactCoordinate(groups.repositoryId!);
  const pullRequestNumber = compactCoordinate(groups.pullRequestNumber!);
  const prefix = `r-${repositoryId}-${pullRequestNumber}-`;
  return `${prefix}${groups.headSha!.slice(0, maximumSandboxIdLength - prefix.length)}`;
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
  createSession: SessionFactory = createInstallationSession,
  resolveInstallation: InstallationResolver = resolveRepositoryInstallation,
): Promise<GitHubCredentialResponse> {
  const request = parseCredentialRequest(rawRequest);
  const ledger = env.REVIEW_LEDGERS.getByName(prKeyFromRequest(request));
  const alreadyAuthorized = await ledger.authorizeCredential(request);
  if (
    !alreadyAuthorized &&
    (request.installationId !== undefined ||
      !(await ledger.canBootstrapCredentialScope(request)))
  ) {
    throw new Error("Credential request is not authorized");
  }
  const credentials = {
    appId: parseAppId(env.GITHUB_APP_ID),
    appSlug: env.GITHUB_APP_SLUG,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
  };
  let installationId = request.installationId;
  if (installationId === undefined) {
    try {
      installationId = await resolveInstallation(
        credentials,
        request.repositoryOwner,
        request.repositoryName,
      );
    } catch {
      throw new CredentialRepositoryNotInstalledError();
    }
    const resolvedRequest = { ...request, installationId };
    if (
      (!alreadyAuthorized &&
        !(await ledger.bootstrapCredentialScope(resolvedRequest))) ||
      !(await ledger.authorizeCredential(resolvedRequest))
    ) {
      throw new CredentialRepositoryNotInstalledError();
    }
  }
  const session = await createSession(
    credentials,
    installationId,
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
