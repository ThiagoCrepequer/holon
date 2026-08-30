interface GitHubEgressParameters {
  readonly repositoryPath: string;
  readonly token: string;
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
    url.protocol !== "http:" ||
    url.hostname !== githubEgressHost ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    !url.pathname.startsWith(`${parameters.repositoryPath}/`) ||
    (request.method !== "GET" && request.method !== "POST")
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
    `Basic ${btoa(`x-access-token:${parameters.token}`)}`,
  );
  return new Request(upstream, {
    ...(request.method === "POST" ? { body: request.body } : {}),
    headers,
    method: request.method,
    redirect: "manual",
  });
}
