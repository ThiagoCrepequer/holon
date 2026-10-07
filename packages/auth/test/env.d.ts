import type { D1Migration } from "cloudflare:test";

interface Env {
  AUTH_DB: D1Database;
  AUTH_MIGRATIONS: D1Migration[];
}

declare module "cloudflare:workers" {
  export const env: Env;
}

declare module "cloudflare:test" {
  export const env: Env;
}
