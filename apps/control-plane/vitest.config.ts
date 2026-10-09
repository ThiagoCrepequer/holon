import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        bindings: { GITHUB_APP_SLUG: "holon-reviewer" },
        serviceBindings: {
          DASHBOARD_ACCESS_EVENTS: "dashboard-access-events-current",
          REPOSITORY_EXECUTOR: "repository-executor-current",
        },
        workers: [
          {
            name: "dashboard-access-events-current",
            compatibilityDate: "2026-08-29",
            modules: true,
            script: `import { WorkerEntrypoint } from "cloudflare:workers"; export default class extends WorkerEntrypoint { applyEvent() {} }`,
          },
          {
            compatibilityDate: "2026-08-29",
            modules: true,
            name: "repository-executor-current",
            script: `
              import { WorkerEntrypoint } from "cloudflare:workers";
              export default class RepositoryExecutorCurrent extends WorkerEntrypoint {
                cleanup() {}
                hasContext() { return false; }
                loadContext() { throw new Error("unused"); }
                prepareRepository() { throw new Error("unused"); }
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
    fileParallelism: false,
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
