import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        serviceBindings: { DELIVERY: { name: "email-delivery-built" } },
        workers: [
          {
            name: "email-delivery-built",
            compatibilityDate: "2026-08-29",
            modules: true,
            scriptPath: "./dist/index.js",
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
});
