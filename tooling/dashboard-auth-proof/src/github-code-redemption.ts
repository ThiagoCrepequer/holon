import { createIdentityPersistence } from "@holon/db/identity/server";
export function reserveGithubCode(
  database: D1Database,
  clientId: string,
  code: string,
): Promise<boolean> {
  return createIdentityPersistence(database).reserveGithubCode(clientId, code);
}
export function pruneExpiredGithubCodes(database: D1Database): Promise<void> {
  return createIdentityPersistence(database).pruneExpiredGithubCodes();
}
