import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        serviceBindings: {
          REPOSITORY_EXECUTOR: "repository-executor-v1",
        },
        workers: [
          {
            compatibilityDate: "2026-08-29",
            modules: true,
            name: "repository-executor-v1",
            script: `
              import { WorkerEntrypoint } from "cloudflare:workers";
              export default class RepositoryExecutorV1 extends WorkerEntrypoint {
                cleanup() {}
                hasContext() { return false; }
                loadContext() { throw new Error("unused"); }
                prepare() { throw new Error("unused"); }
                runTool() { throw new Error("unused"); }
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
