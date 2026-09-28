import {
  diagnosticMessages,
  nativeErrorCode,
  type DiagnosticReason,
} from "./diagnostics.js";
export type GitHubOperationPhase =
  | "app_auth"
  | "installation_auth"
  | "pull_request_refs"
  | "auth_configuration"
  | "jwt_signing"
  | "installation_token_request"
  | "installation_token_response";

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
    public readonly phase?: GitHubOperationPhase,
    public readonly originName?: string,
    public readonly reason?: DiagnosticReason,
    public readonly originCode?: string,
    public readonly githubRequestId?: string,
  ) {
    super(`HOLON_GITHUB_${code.toUpperCase()}:${statusCode ?? "network"}`);
    this.name = "GitHubRequestError";
  }
}

export class GitHubAppAuthenticationError extends GitHubRequestError {
  public constructor(cause?: unknown, phase?: GitHubOperationPhase) {
    super(
      "upstream_permanent",
      false,
      undefined,
      undefined,
      phase,
      safeOriginName(cause),
      diagnose(cause, phase),
      nativeErrorCode(record(cause)?.code),
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
  phase?: GitHubOperationPhase,
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
      diagnose(error, phase),
      nativeErrorCode(record(error)?.code),
      safeRequestId(error),
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
      diagnose(error, phase),
      nativeErrorCode(record(error)?.code),
      safeRequestId(error),
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
      diagnose(error, phase),
      nativeErrorCode(record(error)?.code),
      safeRequestId(error),
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
      diagnose(error, phase),
      nativeErrorCode(record(error)?.code),
      safeRequestId(error),
    );
  }
  return new GitHubRequestError(
    status === undefined ? "invalid_response" : "upstream_permanent",
    false,
    status,
    undefined,
    phase,
    safeOriginName(error),
    diagnose(error, phase),
    nativeErrorCode(record(error)?.code),
    safeRequestId(error),
  );
}

export async function executeGitHubRequest<T>(
  operation: () => Promise<T>,
  phase?: GitHubOperationPhase,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw classifyGitHubRequestError(error, Date.now(), phase);
  }
}

export async function executeGitHubAppAuthenticationRequest<T>(
  operation: () => Promise<T>,
  phase: GitHubOperationPhase,
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

function safeRequestId(error: unknown): string | undefined {
  const value = header(headers(error), "x-github-request-id");
  return value && /^[A-Fa-f0-9:]{8,80}$/u.test(value) ? value : undefined;
}

function diagnose(
  error: unknown,
  phase?: GitHubOperationPhase,
): DiagnosticReason {
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes(
      "Private Key is in PKCS#1 format, but only PKCS#8 is supported",
    )
  )
    return "github_key_pkcs1_unsupported";
  if (
    message.includes(
      "Private Key is in OpenSSH format, but only PKCS#8 is supported",
    )
  )
    return "github_key_openssh_unsupported";
  if (isLocalPrivateKeyError(error)) return "github_key_invalid";
  if (phase === "auth_configuration") return "github_configuration_invalid";
  const status = extractStatusCode(error);
  if (status === 401) return "github_auth_rejected";
  if (
    status === 429 ||
    retryDelay(error, Date.now()) !== undefined ||
    isSecondaryRateLimit(error)
  )
    return "github_rate_limited";
  if (status === 403 || status === 404) return "github_permission_denied";
  if (status !== undefined && status >= 500) return "github_unavailable";
  if (
    phase === "installation_token_response" ||
    record(error)?.name === "ZodError"
  )
    return "github_response_invalid";
  if (
    record(error)?.name === "RequestError" ||
    record(error)?.name === "AbortError"
  )
    return "github_transport_failed";
  return "github_unknown_failure";
}

export class GitHubConfigurationError extends GitHubRequestError {
  public constructor(
    reason:
      | "github_current_key_missing"
      | "github_previous_without_current"
      | "github_app_id_invalid"
      | "github_app_slug_invalid",
  ) {
    super(
      "invalid_response",
      false,
      undefined,
      undefined,
      "auth_configuration",
      "TypeError",
      reason,
    );
    this.message = diagnosticMessages[reason];
  }
}
