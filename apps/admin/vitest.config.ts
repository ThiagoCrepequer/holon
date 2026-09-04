import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    reactRouter(),
    cloudflareTest({
      miniflare: {
        bindings: {
          ACCESS_AUD: "test-audience",
          ACCESS_TEAM_NAME: "test-team",
          ADMIN_CURSOR_HMAC_KEYS:
            '{"primary":{"kid":"test-key","secretHex":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}}',
          AUTHORIZED_EMAIL_DOMAIN: "example.com",
        },
        d1Databases: ["DB"],
        serviceBindings: {
          ADMIN_READ_API: "control-plane-admin-read-mock",
        },
        workers: [
          {
            compatibilityDate: "2026-08-29",
            modules: true,
            name: "control-plane-admin-read-mock",
            script: `
              import { WorkerEntrypoint } from "cloudflare:workers";
              export default class AdminReadMock extends WorkerEntrypoint {
                async pingV1() {
                  return { schemaVersion: 1 };
                }
                async getRunDetailV1() {
                  return null;
                }
              }
            `,
          },
        ],
      },
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    clearMocks: true,
    exclude: ["test/**/*.client.test.tsx"],
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    coverage: {
      include: ["app/**/*.{ts,tsx}", "workers/**/*.ts"],
      exclude: ["app/**/*.client.tsx", "app/entry.client.tsx"],
      provider: "istanbul",
      reporter: ["text", "json-summary", "html", "lcov"],
      thresholds: { branches: 85, functions: 90, lines: 90, statements: 90 },
    },
    mockReset: true,
    outputFile: {
      junit: "junit.xml",
    },
    reporters: ["default", "junit"],
    restoreMocks: true,
  },
});
