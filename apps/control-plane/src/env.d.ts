declare namespace Cloudflare {
  interface Env {
    AI_GATEWAY_ACCOUNT_ID: string;
    AI_GATEWAY_API_TOKEN: string;
    AI_GATEWAY_ID: string;
    AI_MODEL_ID: string;
    GITHUB_APP_ID: string;
    GITHUB_APP_PRIVATE_KEY: string;
    GITHUB_WEBHOOK_SECRET: string;
  }
}

interface Env extends Cloudflare.Env {}
