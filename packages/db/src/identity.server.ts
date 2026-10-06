import { authorityCheck } from "./authority.server.js";
import {
  reserveGithubCode,
  pruneExpiredGithubCodes,
} from "./github-code-redemption.server.js";
export function createIdentityPersistence(database: D1Database) {
  return {
    assertReady: authorityCheck(database, "identity"),
    reserveGithubCode: (clientId: string, code: string) =>
      reserveGithubCode(database, clientId, code),
    pruneExpiredGithubCodes: () => pruneExpiredGithubCodes(database),
  };
}
