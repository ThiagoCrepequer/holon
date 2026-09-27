export type GitHubFailureCode =
  | "invalid_response"
  | "network_transient"
  | "rate_limited"
  | "upstream_permanent"
  | "upstream_transient";

export class GitHubRequestError extends Error {
  public constructor(
    public readonly code: GitHubFailureCode,
    public readonly retryable: boolean,
    public readonly statusCode?: number,
    public readonly retryAfterMs?: number,
    public readonly phase?:
      | "app_auth"
      | "installation_auth"
      | "pull_request_refs",
    public readonly originName?: string,
  ) {
    super(`HOLON_GITHUB_${code.toUpperCase()}:${statusCode ?? "network"}`);
    this.name = "GitHubRequestError";
  }
}

export class GitHubAppAuthenticationError extends GitHubRequestError {
  public constructor(
    cause?: unknown,
    phase?: "app_auth" | "installation_auth",
  ) {
    super(
      "upstream_permanent",
      false,
      undefined,
      undefined,
      phase,
      safeOriginName(cause),
    );
    this.name = "GitHubAppAuthenticationError";
  }
}

export class GitHubDiffTooLargeError extends GitHubRequestError {
  public constructor() {
    super("invalid_response", false);
    this.name = "GitHubDiffTooLargeError";
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function extractStatusCode(error: unknown): number | undefined {
  const root = record(error);
  const response = record(root?.response);
  const candidate = root?.status ?? response?.status;
  return Number.isSafeInteger(candidate) ? Number(candidate) : undefined;
}

function isLocalPrivateKeyError(error: unknown): boolean {
  if (extractStatusCode(error) !== undefined || !(error instanceof Error)) {
    return false;
  }
  if (error.name === "DataError") return true;
  return /(?:asn1|decoder routines|invalid key(?:data)?|no start line|pem routines|private key must|secret or private key must|unsupported key type)/iu.test(
    error.message,
  );
}

function headers(error: unknown): Record<string, unknown> {
  const response = record(record(error)?.response);
  return record(response?.headers) ?? {};
}

function header(
  values: Record<string, unknown>,
  name: string,
): string | undefined {
  const direct = values[name] ?? values[name.toLowerCase()];
  return typeof direct === "string" ? direct : undefined;
}

function boundedDelay(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.min(Math.ceil(value), 86_400_000);
}

function retryDelay(error: unknown, now: number): number | undefined {
  const values = headers(error);
  const retryAfter = header(values, "retry-after");
  if (retryAfter !== undefined) {
    const seconds = Number.parseFloat(retryAfter);
    const delay = boundedDelay(seconds * 1_000);
    if (delay !== undefined) return delay;
  }
  if (header(values, "x-ratelimit-remaining") !== "0") return undefined;
  const reset = header(values, "x-ratelimit-reset");
  if (reset === undefined) return undefined;
  return boundedDelay(Number.parseInt(reset, 10) * 1_000 - now);
}

function isSecondaryRateLimit(error: unknown): boolean {
  const response = record(record(error)?.response);
  const data = record(response?.data);
  const message = typeof data?.message === "string" ? data.message : "";
  return /secondary rate limit|abuse detection/iu.test(message);
}

function safeOriginName(error: unknown): string {
  if (!(error instanceof Error)) return "UnknownError";
  return [
    "Error",
    "TypeError",
    "RangeError",
    "SyntaxError",
    "ZodError",
    "RequestError",
    "AbortError",
    "DataError",
  ].includes(error.name)
    ? error.name
    : "UnknownError";
}

export function classifyGitHubRequestError(
  error: unknown,
  now = Date.now(),
  phase?: "app_auth" | "installation_auth" | "pull_request_refs",
): GitHubRequestError {
  if (error instanceof GitHubRequestError) return error;
  if (error instanceof TypeError) {
    return new GitHubRequestError(
      "invalid_response",
      false,
      undefined,
      undefined,
      phase,
      safeOriginName(error),
    );
  }
  const status = extractStatusCode(error);
  const delay = retryDelay(error, now);
  if (
    status === 429 ||
    delay !== undefined ||
    (status === 403 && isSecondaryRateLimit(error))
  ) {
    return new GitHubRequestError(
      "rate_limited",
      true,
      status,
      delay ?? 60_000,
      phase,
      safeOriginName(error),
    );
  }
  if (status !== undefined && status >= 500) {
    return new GitHubRequestError(
      "upstream_transient",
      true,
      status,
      undefined,
      phase,
      safeOriginName(error),
    );
  }
  if (
    status === undefined &&
    error instanceof Error &&
    (error.name === "RequestError" || error.name === "AbortError")
  ) {
    return new GitHubRequestError(
      "network_transient",
      true,
      undefined,
      undefined,
      phase,
      safeOriginName(error),
    );
  }
  return new GitHubRequestError(
    status === undefined ? "invalid_response" : "upstream_permanent",
    false,
    status,
    undefined,
    phase,
    safeOriginName(error),
  );
}

export async function executeGitHubRequest<T>(
  operation: () => Promise<T>,
  phase?: "pull_request_refs",
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw classifyGitHubRequestError(error, Date.now(), phase);
  }
}

export async function executeGitHubAppAuthenticationRequest<T>(
  operation: () => Promise<T>,
  phase: "app_auth" | "installation_auth",
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isLocalPrivateKeyError(error)) {
      throw new GitHubAppAuthenticationError(error, phase);
    }
    throw classifyGitHubRequestError(error, Date.now(), phase);
  }
}
