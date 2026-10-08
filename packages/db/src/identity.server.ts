import { authorityCheck } from "./authority.server.js";
import {
  reserveGithubCode,
  pruneExpiredGithubCodes,
} from "./github-code-redemption.server.js";
import {
  createD1RateLimitStorage,
  deriveRateLimitKey,
  pruneExpiredRateLimits,
  RateLimitStorageError,
  type RateLimitStorage,
} from "./rate-limit.server.js";
import {
  createTenancyPersistence,
  TenancyError,
  type TenancyErrorCode,
  type TenancyPersistence,
} from "./tenancy.server.js";

export {
  createD1RateLimitStorage,
  createTenancyPersistence,
  deriveRateLimitKey,
  pruneExpiredRateLimits,
  RateLimitStorageError,
  TenancyError,
  type RateLimitStorage,
  type TenancyErrorCode,
  type TenancyPersistence,
};

export function createIdentityPersistence(database: D1Database) {
  const tenancy = createTenancyPersistence(database);
  return {
    assertReady: authorityCheck(database, "identity"),
    reserveGithubCode: (clientId: string, code: string) =>
      reserveGithubCode(database, clientId, code),
    pruneExpiredGithubCodes: () => pruneExpiredGithubCodes(database),
    tenancy,
  };
}
