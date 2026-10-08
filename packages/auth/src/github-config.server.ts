import {
  githubAppAuthConfigSchema,
  type GitHubAppAuthConfig,
  type AuthEnvironment,
} from "@holon/contracts/dashboard";

export type { GitHubAppAuthConfig };

/**
 * Validates GitHub App authentication configuration.
 *
 * Primary sources:
 * - https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
 * - https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
 * - https://better-auth.com/docs/authentication/github
 *
 * NOTE ON GITHUB APPS:
 * GitHub App user access tokens do NOT use OAuth scopes query parameters.
 * Instead, GitHub Apps rely on fine-grained permissions configured directly on the App:
 * Specifically: Account permissions -> Email addresses: Read-only (required by Better Auth).
 * We enforce `disableDefaultScope: true` on Better Auth to prevent it from sending OAuth scopes.
 *
 * ENVIRONMENT POLICY:
 * In accordance with docs/operations/dashboard-environments-and-recovery.md, preview and production
 * environments have no provisioned IDs or registered domains in code yet.
 * Only development is locally provisioned (http://127.0.0.1:8794 or localhost).
 * Any remote environment requires explicit homologated registered origins and fails if not configured.
 */

export interface ValidateGitHubConfigOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly appOrigin: string;
  readonly environment?: AuthEnvironment;
  readonly homologatedOrigins?: ReadonlyMap<AuthEnvironment, readonly string[]>;
}

export function validateGitHubAuthConfig(
  options: ValidateGitHubConfigOptions,
): GitHubAppAuthConfig {
  const environment = options.environment ?? "development";
  const parsed = githubAppAuthConfigSchema.parse({
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    appOrigin: options.appOrigin,
    environment,
  });

  const url = new URL(parsed.appOrigin);
  const isLoopback =
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) ||
    url.hostname.startsWith("127.") ||
    url.hostname.endsWith(".localhost");

  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "appOrigin must not contain credentials, pathname, query, or hash",
    );
  }

  if (environment === "development") {
    if (
      !isLoopback ||
      (url.protocol !== "http:" && url.protocol !== "https:")
    ) {
      throw new Error(
        "development environment must use local loopback origin (127.0.0.1 or localhost)",
      );
    }
  } else {
    if (isLoopback) {
      throw new Error(
        `Environment '${environment}' cannot homologate a loopback origin`,
      );
    }

    if (options.homologatedOrigins) {
      const previewOrigins = new Set(
        options.homologatedOrigins.get("preview") ?? [],
      );
      for (const prodOrigin of options.homologatedOrigins.get("production") ??
        []) {
        if (previewOrigins.has(prodOrigin)) {
          throw new Error(
            "preview and production homologated origins must be disjoint; shared origin detected: " +
              prodOrigin,
          );
        }
      }
    }

    const homologated = options.homologatedOrigins?.get(environment);
    if (
      !homologated ||
      homologated.length === 0 ||
      !homologated.includes(url.origin)
    ) {
      throw new Error(
        `Environment '${environment}' is not yet homologated or provisioned with registered origins; see docs/operations/dashboard-environments-and-recovery.md`,
      );
    }
    if (url.protocol !== "https:") {
      throw new Error(`Environment '${environment}' must use HTTPS`);
    }
  }

  return {
    clientId: parsed.clientId,
    clientSecret: parsed.clientSecret,
    appOrigin: url.origin,
    environment,
  };
}
