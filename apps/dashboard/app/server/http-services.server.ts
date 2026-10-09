import type { AuthService } from "@holon/auth/server";
import {
  CollaborationError,
  deriveRateLimitKey,
  PreferencesError,
  RateLimitStorageError,
  TenancyError,
  type RateLimitStorage,
} from "@holon/db/identity/server";

import { HttpBoundaryError } from "./http-security.server.js";

interface ReadServices {
  readonly authService?: Pick<AuthService, "rateLimitStorage"> | undefined;
  readonly rateLimitStorage?: RateLimitStorage | undefined;
}

export function mapBoundaryError(error: unknown): unknown {
  if (error instanceof CollaborationError) {
    const status = {
      denied: 403,
      reconnect_required: 401,
      unavailable: 503,
      command_unknown: 503,
      conflict: 409,
      rate_limited: 429,
    }[error.code];
    return new HttpBoundaryError(
      error.code === "conflict" ? "invalid_request" : error.code,
      status,
      error.code === "rate_limited" ? 60 : undefined,
    );
  }
  if (error instanceof PreferencesError) {
    if (error.code === "invalid_preferences") {
      return new HttpBoundaryError("invalid_request", 400);
    }
    if (error.code === "user_not_admitted") {
      return new HttpBoundaryError("denied", 403);
    }
    if (error.code === "command_unknown") {
      return new HttpBoundaryError("command_unknown", 503);
    }
    return new HttpBoundaryError("unavailable", 503);
  }
  if (error instanceof TenancyError) {
    if (error.code === "operation_conflict") {
      return new HttpBoundaryError("invalid_request", 409);
    }
    if (error.code === "user_not_admitted") {
      return new HttpBoundaryError("denied", 403);
    }
    if (error.code === "governance_denied") {
      return new HttpBoundaryError("denied", 403);
    }
    if (error.code === "reauth_required") {
      return new HttpBoundaryError("reconnect_required", 401);
    }
    if (error.code === "member_not_found") {
      return new HttpBoundaryError("invalid_request", 404);
    }
    if (error.code === "invalid_role_transition") {
      return new HttpBoundaryError("invalid_request", 400);
    }
    if (error.code === "command_unknown") {
      return new HttpBoundaryError("command_unknown", 503);
    }
    return new HttpBoundaryError("unavailable", 503);
  }
  if (error instanceof RateLimitStorageError) {
    return new HttpBoundaryError("unavailable", 503);
  }
  return error;
}

export async function consumeReadRateLimit(
  request: Request,
  services: ReadServices,
  action: string,
): Promise<void> {
  const rateLimiter =
    services.rateLimitStorage ?? services.authService?.rateLimitStorage;
  if (!rateLimiter) {
    throw new HttpBoundaryError("unavailable", 503);
  }
  const clientIdentifier =
    request.headers.get("cf-connecting-ip")?.trim() || "anonymous";
  const rateKey = await deriveRateLimitKey("read", clientIdentifier, action);
  const rateResult = await rateLimiter.consume(rateKey, {
    window: 60,
    max: 120,
  });
  if (!rateResult.allowed) {
    throw new HttpBoundaryError(
      "rate_limited",
      429,
      rateResult.retryAfter ?? 60,
    );
  }
}
