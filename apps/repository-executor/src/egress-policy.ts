interface GitHubEgressParameters {
  readonly repositoryPath: string;
  readonly token: string;
}

function parseParameters(value: unknown): GitHubEgressParameters | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const repositoryPath = candidate.repositoryPath;
  const token = candidate.token;
  if (
    typeof repositoryPath !== "string" ||
    typeof token !== "string" ||
    token.length === 0
  )
    return undefined;
  const repositoryMatch = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\.git$/u.exec(
    repositoryPath,
  );
  if (
    repositoryMatch === null ||
    repositoryMatch[1] === "." ||
    repositoryMatch[1] === ".." ||
    repositoryMatch[2] === "." ||
    repositoryMatch[2] === ".."
  ) {
    return undefined;
  }
  return { repositoryPath, token };
}

export function authenticateGitHubRequest(
  request: Request,
  rawParameters: unknown,
): Request | undefined {
  const parameters = parseParameters(rawParameters);
  const url = new URL(request.url);
  if (
    parameters === undefined ||
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    !url.pathname.startsWith(`${parameters.repositoryPath}/`) ||
    (request.method !== "GET" && request.method !== "POST")
  ) {
    return undefined;
  }
  const authenticated = new Request(request, { redirect: "manual" });
  authenticated.headers.set(
    "Authorization",
    `Basic ${btoa(`x-access-token:${parameters.token}`)}`,
  );
  return authenticated;
}
