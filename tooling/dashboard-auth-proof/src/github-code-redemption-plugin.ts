import type { BetterAuthPlugin } from "better-auth";

import { reserveGithubCode } from "./github-code-redemption.js";

export function githubCodeRedemptionPlugin(
  database: D1Database,
): BetterAuthPlugin {
  return {
    id: "holon-github-code-redemption",
    init(context) {
      const github = context.options.socialProviders?.github;
      if (
        !github ||
        typeof github !== "object" ||
        !github.clientId ||
        !Array.isArray(context.socialProviders)
      ) {
        throw new Error("GitHub redemption requires one static GitHub client");
      }
      const clientId = github.clientId;
      if (
        context.socialProviders.filter((provider) => provider.id === "github")
          .length !== 1
      ) {
        throw new Error("GitHub redemption requires one static GitHub client");
      }
      return {
        context: {
          socialProviders: context.socialProviders.map((provider) =>
            provider.id !== "github"
              ? provider
              : {
                  ...provider,
                  async validateAuthorizationCode(params) {
                    // Native callback has validated state, browser cookie and expiry here.
                    // Reservation is never released: unknown outcomes require a fresh OAuth.
                    if (
                      !(await reserveGithubCode(
                        database,
                        clientId,
                        params.code,
                      ))
                    )
                      return null;
                    return provider.validateAuthorizationCode(params);
                  },
                },
          ),
        },
      };
    },
  };
}
