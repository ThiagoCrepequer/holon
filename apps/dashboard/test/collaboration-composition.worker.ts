import {
  env,
  applyD1Migrations,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { afterEach, beforeEach } from "vitest";

import {
  seedCollaboration,
  collaborationCases,
} from "./support/collaboration-cases.js";
const bindings = env as unknown as {
  IDENTITY_DB: D1Database;
  IDENTITY_MIGRATIONS: D1Migration[];
};
beforeEach(async () => {
  await applyD1Migrations(bindings.IDENTITY_DB, bindings.IDENTITY_MIGRATIONS);
  await seedCollaboration(bindings.IDENTITY_DB);
});
afterEach(async () => reset());
collaborationCases(() => bindings.IDENTITY_DB);
