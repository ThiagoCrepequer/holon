import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        serviceBindings: {
          REPOSITORY_EXECUTOR: "repository-executor-current",
        },
        workers: [
          {
            compatibilityDate: "2026-08-29",
            modules: true,
            name: "repository-executor-current",
            script: `
              import { WorkerEntrypoint } from "cloudflare:workers";
              export default class RepositoryExecutorCurrent extends WorkerEntrypoint {
                cleanup() {}
                hasContext() { return false; }
                async openContext() {
                  const content = "x".repeat(1600000);
                  const bytes = new TextEncoder().encode(content);
                  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
                  let offset = 0;
                  return {
                    manifest: { bytes: bytes.length, digest, pages: 50 },
                    stream: new ReadableStream({
                      pull(controller) {
                        controller.enqueue(bytes.slice(offset, offset + 32000));
                        offset += 32000;
                        if (offset === bytes.length) controller.close();
                      }
                    })
                  };
                }
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
