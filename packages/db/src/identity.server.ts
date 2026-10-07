import { authorityCheck } from "./authority.server.js";
import {
  reserveGithubCode,
  pruneExpiredGithubCodes,
} from "./github-code-redemption.server.js";
import {
  createTenancyPersistence,
  type TenancyPersistence,
} from "./tenancy.server.js";

export { createTenancyPersistence, type TenancyPersistence };

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
