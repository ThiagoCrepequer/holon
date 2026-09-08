import {
  createInstallationSession,
  resolveRepositoryInstallation,
  type GitHubInstallationSession,
} from "./client.js";
import { GitHubAppAuthenticationError, GitHubRequestError } from "./errors.js";

export interface GitHubAppKeyring {
  readonly appId: number;
  readonly appSlug: string;
  readonly currentPrivateKey: string;
  readonly previousPrivateKey?: string | undefined;
}

export interface GitHubAppKeyringEnv {
  readonly GITHUB_APP_ID: number | string;
  readonly GITHUB_APP_SLUG: string;
  readonly GITHUB_APP_PRIVATE_KEY_CURRENT?: string | undefined;
  readonly GITHUB_APP_PRIVATE_KEY_PREVIOUS?: string | undefined;
}

export interface KeyringKeySummary {
  readonly fingerprint: string;
  readonly role: "current" | "previous";
}

export type KeyringTelemetryEventType =
  | "github_app_auth.all_keys_rejected"
  | "github_app_auth.circuit_breaker_opened"
  | "github_app_auth.circuit_breaker_reset"
  | "github_app_auth.fallback_succeeded";

export interface KeyringTelemetryEvent {
  readonly event: KeyringTelemetryEventType;
  readonly fields: Readonly<
    Record<string, boolean | number | string | undefined>
  >;
}

export interface KeyringCircuitBreaker {
  isOpen(now?: number): boolean;
  reset(): void;
  trip(ttlMs?: number, now?: number): void;
}

/**
 * In-memory circuit breaker that silences an invalid CURRENT key for a configurable TTL
 * after a successful fallback to PREVIOUS, preventing GitHub anti-abuse 403 blocks.
 */
export class MemoryKeyringCircuitBreaker implements KeyringCircuitBreaker {
  private openUntil = 0;

  public constructor(private readonly defaultTtlMs = 300_000) {}

  public isOpen(now = Date.now()): boolean {
    return now < this.openUntil;
  }

  public trip(ttlMs = this.defaultTtlMs, now = Date.now()): void {
    this.openUntil = now + ttlMs;
  }

  public reset(): void {
    this.openUntil = 0;
  }
}

export const defaultKeyringCircuitBreaker = new MemoryKeyringCircuitBreaker();

function normalizedKeyMaterial(rawKey: string): string {
  return rawKey
    .replace(/-----BEGIN [^-]+-----/gu, "")
    .replace(/-----END [^-]+-----/gu, "")
    .replace(/\s+/gu, "");
}

/**
 * Computes a non-secret, deterministic 8-character cryptographic key fingerprint (e.g. `key:3a9f1b2c`)
 * from the normalized Base64/DER bytes of a PEM string, regardless of line endings or whitespace.
 */
export async function computeKeyFingerprint(rawKey: string): Promise<string> {
  const base64Only = normalizedKeyMaterial(rawKey);

  if (base64Only.length === 0) {
    return "key:empty";
  }

  try {
    const binary = atob(base64Only);
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      buffer[i] = binary.charCodeAt(i);
    }
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const hex = [...new Uint8Array(digest)]
      .slice(0, 4)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `key:${hex}`;
  } catch {
    const rawDigest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(base64Only),
    );
    const hex = [...new Uint8Array(rawDigest)]
      .slice(0, 4)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `key:${hex}`;
  }
}

/**
 * Strictly classifies errors as App authentication/signature rejections (401, JWT verification failures, PEM crypto errors).
 * Explicitly excludes 403 (permissions / secondary rate limits), 404, 429, 5xx, or network aborts.
 */
export function isAppAuthenticationError(error: unknown): boolean {
  if (error instanceof GitHubAppAuthenticationError) {
    return true;
  }
  if (error instanceof GitHubRequestError) {
    return error.statusCode === 401;
  }
  const candidate = error as {
    message?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  if (candidate.status === 401 || candidate.statusCode === 401) {
    return true;
  }
  if (typeof candidate.message === "string") {
    const msg = candidate.message.toLowerCase();
    return (
      msg.includes("json web token") ||
      msg.includes("bad credentials") ||
      msg.includes("secret or private key must have a value") ||
      msg.includes("unsupported key type") ||
      msg.includes("invalid key") ||
      msg.includes("asn1")
    );
  }
  return false;
}

function parseAppId(value: number | string): number {
  const normalized = typeof value === "string" ? value.trim() : value;
  if (typeof normalized === "string" && !/^[1-9]\d*$/u.test(normalized)) {
    throw new TypeError("GitHub App ID must be a positive safe integer");
  }
  const parsed =
    typeof normalized === "number" ? normalized : Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError("GitHub App ID must be a positive safe integer");
  }
  return parsed;
}

export function resolveGitHubAppKeyring(
  env: GitHubAppKeyringEnv,
): GitHubAppKeyring {
  const current = env.GITHUB_APP_PRIVATE_KEY_CURRENT?.trim();
  const previous = env.GITHUB_APP_PRIVATE_KEY_PREVIOUS?.trim();
  if (!current) {
    throw new TypeError(
      previous
        ? "GITHUB_APP_PRIVATE_KEY_PREVIOUS cannot be configured without a CURRENT key"
        : "Missing GitHub App private key: configure GITHUB_APP_PRIVATE_KEY_CURRENT",
    );
  }
  const resolvedCurrent = current;
  let resolvedPrevious = previous;

  // Deduplicate if identical
  if (
    resolvedCurrent &&
    resolvedPrevious &&
    normalizedKeyMaterial(resolvedCurrent) ===
      normalizedKeyMaterial(resolvedPrevious)
  ) {
    resolvedPrevious = undefined;
  }

  return {
    appId: parseAppId(env.GITHUB_APP_ID),
    appSlug: env.GITHUB_APP_SLUG,
    currentPrivateKey: resolvedCurrent,
    ...(resolvedPrevious ? { previousPrivateKey: resolvedPrevious } : {}),
  };
}

export interface KeyringOperationOptions {
  readonly circuitBreaker?: KeyringCircuitBreaker | undefined;
  readonly onTelemetry?: ((event: KeyringTelemetryEvent) => void) | undefined;
}

async function executeKeyringOperation<T>(
  keyring: GitHubAppKeyring,
  operation: (privateKey: string) => Promise<T>,
  options?: KeyringOperationOptions,
): Promise<T> {
  const circuitBreaker =
    options?.circuitBreaker ?? defaultKeyringCircuitBreaker;
  const previousPrivateKey = keyring.previousPrivateKey;

  if (circuitBreaker.isOpen() && previousPrivateKey) {
    const previousFingerprint = await computeKeyFingerprint(previousPrivateKey);
    try {
      return await operation(previousPrivateKey);
    } catch (error) {
      options?.onTelemetry?.({
        event: "github_app_auth.all_keys_rejected",
        fields: {
          circuitBreakerOpen: true,
          errorKind: error instanceof Error ? error.name : "UnknownError",
          keyFingerprint: previousFingerprint,
          role: "previous",
        },
      });
      throw error;
    }
  }

  const currentFingerprint = await computeKeyFingerprint(
    keyring.currentPrivateKey,
  );
  try {
    const result = await operation(keyring.currentPrivateKey);
    if (circuitBreaker.isOpen()) {
      circuitBreaker.reset();
      options?.onTelemetry?.({
        event: "github_app_auth.circuit_breaker_reset",
        fields: {
          keyFingerprint: currentFingerprint,
          role: "current",
        },
      });
    }
    return result;
  } catch (error) {
    if (!previousPrivateKey || !isAppAuthenticationError(error)) {
      throw error;
    }

    const previousFingerprint = await computeKeyFingerprint(previousPrivateKey);
    try {
      const result = await operation(previousPrivateKey);
      circuitBreaker.trip();
      options?.onTelemetry?.({
        event: "github_app_auth.circuit_breaker_opened",
        fields: {
          currentFingerprint,
          fallbackFingerprint: previousFingerprint,
        },
      });
      options?.onTelemetry?.({
        event: "github_app_auth.fallback_succeeded",
        fields: {
          keyFingerprint: previousFingerprint,
          primaryFailedFingerprint: currentFingerprint,
        },
      });
      return result;
    } catch (previousError) {
      options?.onTelemetry?.({
        event: "github_app_auth.all_keys_rejected",
        fields: {
          currentFingerprint,
          errorKind:
            previousError instanceof Error
              ? previousError.name
              : "UnknownError",
          previousFingerprint,
        },
      });
      throw previousError;
    }
  }
}

/**
 * Creates a GitHubInstallationSession with resilient key rotation support:
 * 1. Checks circuit breaker: if OPEN and previous key exists, routes directly to previous key.
 * 2. Tries current key. If successful and breaker was open, resets breaker.
 * 3. On 401/JWT authentication error with previous key available, executes single fallback to previous key.
 * 4. If fallback succeeds, trips circuit breaker to silence invalid current key and emits telemetry.
 */
export async function createInstallationSessionWithKeyring(
  keyring: GitHubAppKeyring,
  installationId: number,
  repositoryId: number,
  options?: KeyringOperationOptions,
): Promise<GitHubInstallationSession> {
  return await executeKeyringOperation(
    keyring,
    async (privateKey) =>
      await createInstallationSession(
        {
          appId: keyring.appId,
          appSlug: keyring.appSlug,
          privateKey,
        },
        installationId,
        repositoryId,
      ),
    options,
  );
}

/**
 * Resolves repository installation ID with resilient key rotation support.
 */
export async function resolveRepositoryInstallationWithKeyring(
  keyring: GitHubAppKeyring,
  owner: string,
  repo: string,
  options?: KeyringOperationOptions,
): Promise<number> {
  return await executeKeyringOperation(
    keyring,
    async (privateKey) =>
      await resolveRepositoryInstallation(
        {
          appId: keyring.appId,
          appSlug: keyring.appSlug,
          privateKey,
        },
        owner,
        repo,
      ),
    options,
  );
}
