/**
 * Dedicated server integration export for authentication adapters (packages/auth).
 * Direct Drizzle ORM tables are NOT exposed to the public identity API or apps/dashboard.
 */
export {
  identityAuthSchema,
  user,
  session,
  account,
  verification,
} from "./schema.server.js";
