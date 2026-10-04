import {
  resolveGitHubAppKeyring,
  type GitHubAppKeyring,
  type KeyringOperationOptions,
  type KeyringTelemetryEvent,
} from "@holon/github";

import type { StructuredLogger } from "../observability.js";

export function resolveControlPlaneKeyring(
  env: Cloudflare.Env,
): GitHubAppKeyring {
  return resolveGitHubAppKeyring({
    GITHUB_APP_ID: env.GITHUB_APP_ID,
    GITHUB_APP_PRIVATE_KEY_CURRENT: env.GITHUB_APP_PRIVATE_KEY_CURRENT,
    GITHUB_APP_PRIVATE_KEY_PREVIOUS: env.GITHUB_APP_PRIVATE_KEY_PREVIOUS,
    GITHUB_APP_SLUG: env.GITHUB_APP_SLUG,
  });
}

export function createKeyringTelemetryOptions(
  logger?: StructuredLogger,
  baseContext?: Readonly<Record<string, boolean | number | string | undefined>>,
): KeyringOperationOptions {
  if (!logger) return {};
  return {
    onTelemetry: (event: KeyringTelemetryEvent) => {
      logger.emit(event.event, {
        ...baseContext,
        ...event.fields,
      });
    },
  };
}
