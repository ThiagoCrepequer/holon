import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
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
    coverage: {
      include: ["workers/**/*.ts"],
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
