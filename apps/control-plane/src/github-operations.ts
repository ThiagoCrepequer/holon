import { GitHubRequestError } from "@holon/github";
import { NonRetryableError } from "cloudflare:workflows";

const minimumRetryDelayMs = 1_000;
const maximumRetryDelayMs = 5 * 60_000;

interface WorkflowRetryContext {
  readonly attempt?: number;
  readonly ctx?: { readonly attempt: number };
  readonly error: unknown;
}

export class GitHubTransientError extends Error {
  public constructor(
    reason: "rate-limit" | "server" | "transport",
    public readonly retryAfterMs?: number,
  ) {
    super(`HOLON_GITHUB_TRANSIENT:${reason}`);
    this.name = "GitHubTransientError";
  }
}

function statusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }
  return typeof error.status === "number" ? error.status : undefined;
}

function responseHeaders(error: unknown): unknown {
  if (
    typeof error !== "object" ||
    error === null ||
    !("response" in error) ||
    typeof error.response !== "object" ||
    error.response === null ||
    !("headers" in error.response)
  ) {
    return undefined;
  }
  return error.response.headers;
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (typeof headers !== "object" || headers === null) return undefined;
  const record = headers as Record<string, unknown>;
  const value = record[name] ?? record[name.toLowerCase()];
  return typeof value === "string" ? value : undefined;
}

function boundedDelay(value: number): number {
  return Math.min(
    maximumRetryDelayMs,
    Math.max(minimumRetryDelayMs, Math.ceil(value)),
  );
}

function rateLimitDelayMs(
  error: unknown,
  nowMilliseconds: () => number,
): number | undefined {
  const headers = responseHeaders(error);
  const retryAfter = headerValue(headers, "retry-after");
  if (retryAfter !== undefined) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return boundedDelay(seconds * 1_000);
    }
  }
  if (headerValue(headers, "x-ratelimit-remaining") !== "0") {
    return undefined;
  }
  const reset = Number(headerValue(headers, "x-ratelimit-reset"));
  if (!Number.isFinite(reset) || reset <= 0) return minimumRetryDelayMs;
  return boundedDelay(reset * 1_000 - nowMilliseconds());
}

export async function executeGitHubOperation<T>(
  operation: () => Promise<T>,
  nowMilliseconds: () => number = Date.now,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof NonRetryableError) throw error;
    if (error instanceof GitHubTransientError) throw error;
    if (error instanceof GitHubRequestError) {
      if (error.retryable) {
        const reason =
          error.code === "rate_limited"
            ? "rate-limit"
            : error.code === "upstream_transient"
              ? "server"
              : "transport";
        throw new GitHubTransientError(reason, error.retryAfterMs);
      }
      throw new NonRetryableError(`HOLON_GITHUB_NON_RETRYABLE:${error.code}`);
    }
    const status = statusCode(error);
    const rateDelay = rateLimitDelayMs(error, nowMilliseconds);
    if (status === 429 || (status === 403 && rateDelay !== undefined)) {
      throw new GitHubTransientError(
        "rate-limit",
        rateDelay ?? minimumRetryDelayMs,
      );
    }
    if (
      status !== undefined &&
      (status >= 500 || [408, 409].includes(status))
    ) {
      throw new GitHubTransientError("server");
    }
    if (status !== undefined && status >= 400 && status < 500) {
      throw new NonRetryableError(`HOLON_GITHUB_NON_RETRYABLE:${status}`);
    }
    if (
      error instanceof TypeError ||
      (error instanceof Error && error.name === "GitHubDiffTooLargeError")
    ) {
      throw new NonRetryableError("HOLON_GITHUB_NON_RETRYABLE:response");
    }
    throw new GitHubTransientError("transport");
  }
}

export function githubRetryDelay(context: WorkflowRetryContext): number {
  const retryAfter =
    typeof context.error === "object" &&
    context.error !== null &&
    "retryAfterMs" in context.error &&
    typeof context.error.retryAfterMs === "number"
      ? context.error.retryAfterMs
      : undefined;
  if (retryAfter !== undefined) return boundedDelay(retryAfter);
  const attempt = context.ctx?.attempt ?? context.attempt ?? 1;
  return Math.min(60_000, 5_000 * 2 ** Math.max(0, attempt - 1));
}
