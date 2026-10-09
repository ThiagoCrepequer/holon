import { readD1Migrations, cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      miniflare: {
        d1Databases: { PROJECTION_DB: "core-projection-test" },
        bindings: {
          GITHUB_APP_SLUG: "holon-reviewer",
          PROJECTION_MIGRATIONS: await readD1Migrations(
            "../../packages/db/migrations/projection",
          ),
        },
        serviceBindings: {
          REVIEW_PROJECTION: {
            name: "projection-writer-current",
            entrypoint: "ReviewProjectionWriter",
          },
          DASHBOARD_ACCESS_EVENTS: "dashboard-access-events-current",
          REPOSITORY_EXECUTOR: "repository-executor-current",
        },
        workers: [
          {
            name: "projection-writer-current",
            compatibilityDate: "2026-08-29",
            modules: true,
            scriptPath: "./dist/projection/projection-worker.js",
            bindings: { DASHBOARD_RECOVERY_MODE: "active" },
            d1Databases: { PROJECTION_DB: "core-projection-test" },
          },
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
              import { WorkerEntrypoint, RpcTarget } from "cloudflare:workers";
              const reads = new Map();
              const content = "if (value !== null) return value.id;";
              class ReadOperation extends RpcTarget {
                result() { return { content, truncated: false }; }
                cancel() {}
                [Symbol.dispose]() {}
              }
              export default class RepositoryExecutorCurrent extends WorkerEntrypoint {
                cleanup() {}
                hasContext() { return false; }
                loadContext() { throw new Error("unused"); }
                prepareRepository() { throw new Error("unused"); }
                runTool() { throw new Error("unused"); }
                startTool(runId, call) {
                  if (call.name !== "read_file" || call.arguments.path !== "src/caller.ts") throw new Error("Unexpected test executor operation");
                  reads.set(runId, true);
                  return new ReadOperation();
                }
                async getEvidencePack(runId) {
                  if (!reads.has(runId)) return [];
                  const hash = async text => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2,"0")).join("");
                  const identity = { digest: await hash(content), runId, headSha: runId.split(":head:")[1].split(":base:")[0], path: "src/caller.ts", startLine: 1, endLine: 1, truncated: false };
                  return [{ receipt: { ...identity, id: await hash(JSON.stringify(identity)) }, content }];
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
    include: ["test/**/*.test.ts"],
    clearMocks: true,
    fileParallelism: false,
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
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
}));
