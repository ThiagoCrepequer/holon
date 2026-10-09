import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        d1Databases: { IDENTITY_DB: "email-test-identity" },
        bindings: {
          IDENTITY_MIGRATIONS: await readD1Migrations(
            "../../packages/db/migrations/identity",
          ),
        },
        serviceBindings: {
          DELIVERY: { name: "email-delivery-built" },
          EMAIL_AUTHORITY: { name: "email-authority-test" },
        },
        workers: [
          {
            name: "email-authority-test",
            bindings: { DASHBOARD_RECOVERY_MODE: "active" },
            compatibilityDate: "2026-08-29",
            modules: true,
            scriptPath: "./dist/authority/authority.js",
            d1Databases: { IDENTITY_DB: "email-test-identity" },
          },
          {
            name: "email-delivery-built",
            compatibilityDate: "2026-08-29",
            modules: true,
            scriptPath: "./dist/index.js",
            queueProducers: { EMAIL_JOBS: "built-test-jobs" },
            bindings: { EMAIL_SEND_ENABLED: "true" },
          },
        ],
      },
    }),
  ],
  test: {
    reporters: ["default", "junit"],
    outputFile: { junit: "junit.xml" },
    fileParallelism: false,
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      reporter: ["text", "json-summary", "lcov"],
      thresholds: { branches: 85, functions: 90, lines: 90, statements: 90 },
    },
  },
}));
