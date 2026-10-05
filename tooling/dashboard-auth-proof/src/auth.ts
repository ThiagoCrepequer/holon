import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzle } from "drizzle-orm/d1";

import { githubCodeRedemptionPlugin } from "./github-code-redemption-plugin.js";
import * as schema from "./schema.js";

export const origin = "https://dashboard-proof.invalid";

export type ProofPersistence = "drizzle" | "native-d1";

function createAuth(
  database: D1Database,
  persistence: ProofPersistence,
  plugins: BetterAuthPlugin[],
) {
  return betterAuth({
    baseURL: origin,
    plugins,
    secret: "synthetic-proof-secret-not-valid-outside-this-test-0001",
    database:
      persistence === "native-d1"
        ? database
        : drizzleAdapter(drizzle(database, { schema }), {
            provider: "sqlite",
            schema,
            transaction: false,
          }),
    socialProviders: {
      github: {
        clientId: "synthetic-client-id",
        clientSecret: "synthetic-client-secret",
        disableDefaultScope: true,
      },
    },
    account: {
      encryptOAuthTokens: true,
      storeAccountCookie: false,
      // Keep native verified-email linking; no trustedProviders verification bypass.
      accountLinking: { trustedProviders: [] },
    },
    session: {
      expiresIn: 7 * 86400,
      updateAge: 86400,
      cookieCache: { enabled: false },
    },
    advanced: { useSecureCookies: true },
    trustedOrigins: [origin],
    logger: { disabled: true },
    rateLimit: { enabled: false },
  });
}

export function createProofAuth(
  database: D1Database,
  persistence: ProofPersistence = "drizzle",
) {
  return createAuth(database, persistence, [
    githubCodeRedemptionPlugin(database),
  ]);
}

// Diagnostic baseline only: never an alternative production authentication mode.
export function createNativeProofAuth(
  database: D1Database,
  persistence: ProofPersistence = "drizzle",
) {
  return createAuth(database, persistence, []);
}

export type ProofAuth = ReturnType<typeof createProofAuth>;
