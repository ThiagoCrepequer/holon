import { authorityCheck } from "./authority.server.js";
/** Projection adapters are added with M5; no universal ORM escapes this boundary. */
export function createProjectionPersistence(database: D1Database) {
  return { assertReady: authorityCheck(database, "projection") };
}
