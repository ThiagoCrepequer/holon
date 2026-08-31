export interface GitHubEgressAuthorization {
  readonly installationId?: number;
  readonly repositoryId: number;
  readonly repositoryName: string;
  readonly repositoryOwner: string;
  readonly repositoryPath: string;
  readonly runId: string;
}

export const githubEgressHost = "github.holon.internal";

export function createGitHubEgressUrl(cloneUrl: string): string {
  const source = new URL(cloneUrl);
  if (
    source.protocol !== "https:" ||
    source.hostname !== "github.com" ||
    source.username.length > 0 ||
    source.password.length > 0
  ) {
    throw new TypeError("Expected a credential-free GitHub HTTPS clone URL");
  }
  return `http://${githubEgressHost}${source.pathname}`;
}

const authorizationKeys = [
  "repositoryId",
  "repositoryName",
  "repositoryOwner",
  "repositoryPath",
  "runId",
] as const;

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value > 0;
}

export function parseGitHubEgressAuthorization(
  value: unknown,
): GitHubEgressAuthorization | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const actualKeys = Object.keys(candidate).toSorted();
  const expectedKeys = [...authorizationKeys].toSorted();
  const expectedV2Keys = [...authorizationKeys, "installationId"].toSorted();
  if (
    actualKeys.join("\0") !== expectedKeys.join("\0") &&
    actualKeys.join("\0") !== expectedV2Keys.join("\0")
  ) {
    return undefined;
  }
  const installationId = candidate.installationId;
  const repositoryId = candidate.repositoryId;
  const repositoryName = candidate.repositoryName;
  const repositoryOwner = candidate.repositoryOwner;
  const repositoryPath = candidate.repositoryPath;
  const runId = candidate.runId;
  if (
    (installationId !== undefined && !isPositiveSafeInteger(installationId)) ||
    !isPositiveSafeInteger(repositoryId) ||
    typeof repositoryName !== "string" ||
    typeof repositoryOwner !== "string" ||
    typeof repositoryPath !== "string" ||
    typeof runId !== "string"
  )
    return undefined;
  const repositorySegment = /^[A-Za-z0-9_.-]+$/u;
  if (
    !repositorySegment.test(repositoryOwner) ||
    !repositorySegment.test(repositoryName) ||
    repositoryOwner === "." ||
    repositoryOwner === ".." ||
    repositoryName === "." ||
    repositoryName === ".." ||
    repositoryPath !== `/${repositoryOwner}/${repositoryName}.git` ||
    !new RegExp(
      `^github:${repositoryId}:pr:[1-9][0-9]*:head:[0-9a-f]{40}$`,
      "u",
    ).test(runId)
  ) {
    return undefined;
  }
  return {
    ...(installationId === undefined ? {} : { installationId }),
    repositoryId,
    repositoryName,
    repositoryOwner,
    repositoryPath,
    runId,
  };
}

export function authenticateGitHubRequest(
  request: Request,
  rawParameters: unknown,
  installationToken: string,
): Request | undefined {
  const parameters = validateGitHubEgressRequest(request, rawParameters);
  if (
    parameters === undefined ||
    installationToken.length === 0 ||
    installationToken.length > 1_024
  ) {
    return undefined;
  }
  const upstream = new URL(request.url);
  upstream.protocol = "https:";
  upstream.hostname = "github.com";
  upstream.port = "";
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete("host");
  headers.set(
    "Authorization",
    `Basic ${btoa(`x-access-token:${installationToken}`)}`,
  );
  return new Request(upstream, {
    ...(request.method === "POST" ? { body: request.body } : {}),
    headers,
    method: request.method,
    redirect: "manual",
  });
}

export function validateGitHubEgressRequest(
  request: Request,
  rawParameters: unknown,
): GitHubEgressAuthorization | undefined {
  const parameters = parseGitHubEgressAuthorization(rawParameters);
  const url = new URL(request.url);
  if (
    parameters === undefined ||
    url.protocol !== "http:" ||
    url.hostname !== githubEgressHost ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    !url.pathname.startsWith(`${parameters.repositoryPath}/`) ||
    (request.method !== "GET" && request.method !== "POST")
  ) {
    return undefined;
  }
  return parameters;
}
