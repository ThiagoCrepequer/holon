import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [cloudflareTest({ miniflare: { compatibilityDate: "2026-08-29" } })],
  test: {
    reporters: ["default", "junit"],
    outputFile: { junit: "junit.workers.xml" },
    include: ["test/http-security.test.ts"],
    fileParallelism: false,
    coverage: {
      provider: "istanbul",
      include: ["app/server/**/*.ts"],
      reporter: ["text", "json-summary", "lcov"],
      thresholds: { branches: 85, functions: 90, lines: 90, statements: 90 },
      reportsDirectory: "coverage/workers",
    },
  },
});
