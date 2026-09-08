import type { RepositoryExecutorBinding } from "./review-services.js";

declare global {
  namespace Cloudflare {
    interface Env {
      AI_GATEWAY_ACCOUNT_ID: string;
      AI_GATEWAY_API_TOKEN: string;
      AI_GATEWAY_ID: string;
      AI_MODEL_ID: string;
      GITHUB_APP_ID: string;
      GITHUB_APP_PRIVATE_KEY_CURRENT?: string;
      GITHUB_APP_PRIVATE_KEY_PREVIOUS?: string;
      GITHUB_APP_SLUG: string;
      GITHUB_WEBHOOK_SECRET: string;
      REPOSITORY_EXECUTOR: Fetcher & RepositoryExecutorBinding;
    }
  }
}

interface Env extends Cloudflare.Env {}
