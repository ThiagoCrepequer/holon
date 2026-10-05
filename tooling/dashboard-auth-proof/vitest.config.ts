import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-08-29",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["AUTH_DB"],
      },
    }),
  ],
  test: {
    fileParallelism: false,
    testTimeout: 15000,
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      reporter: ["text", "json-summary", "lcov"],
      thresholds: { branches: 85, functions: 90, lines: 90, statements: 90 },
    },
  },
});
