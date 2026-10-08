import { authorityCheck } from "./authority.server.js";
import {
  reserveGithubCode,
  pruneExpiredGithubCodes,
} from "./github-code-redemption.server.js";
import {
  createPreferencesPersistence,
  PreferencesError,
  type PreferencesPersistence,
  type PreferencesErrorCode,
} from "./preferences.server.js";
import {
  createD1RateLimitStorage,
  deriveRateLimitKey,
  pruneExpiredRateLimits,
  RateLimitStorageError,
  type RateLimitStorage,
} from "./rate-limit.server.js";
import {
  createSessionPersistence,
  parseDeviceBrowserLabel,
  type SessionPersistence,
  type RenewSessionResult,
} from "./session.server.js";
import {
  createTenancyPersistence,
  TenancyError,
  type TenancyErrorCode,
  type TenancyPersistence,
  type PendingReauthContext,
} from "./tenancy.server.js";

export {
  createPreferencesPersistence,
  PreferencesError,
  type PreferencesPersistence,
  type PreferencesErrorCode,
  createD1RateLimitStorage,
  createSessionPersistence,
  createTenancyPersistence,
  deriveRateLimitKey,
  parseDeviceBrowserLabel,
  pruneExpiredRateLimits,
  RateLimitStorageError,
  TenancyError,
  type RateLimitStorage,
  type SessionPersistence,
  type RenewSessionResult,
  type TenancyErrorCode,
  type TenancyPersistence,
  type PendingReauthContext,
};

export function createIdentityPersistence(database: D1Database) {
  const tenancy = createTenancyPersistence(database);
  return {
    assertReady: authorityCheck(database, "identity"),
    reserveGithubCode: (clientId: string, code: string) =>
      reserveGithubCode(database, clientId, code),
    pruneExpiredGithubCodes: () => pruneExpiredGithubCodes(database),
    tenancy,
    preferences: createPreferencesPersistence(database),
  };
}

export {
  createInvitationPersistence,
  type RecipientProof,
} from "./invitations.server.js";
export {
  CollaborationError,
  type CollaborationErrorCode,
} from "./collaboration-error.server.js";

export {
  createConnectionPersistence,
  type InstallationProof,
} from "./github-connections.server.js";

export {
  createGrantPersistence,
  type GrantIdentity,
} from "./github-grants.server.js";
