import { defineConfig } from "vitest/config";

/** One production inventory and report for both Node policies and Workerd adapters. */
export default defineConfig({
  test: {
    projects: ["./vitest.config.ts", "./vitest.worker.config.ts"],
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.{ts,tsx}"],
      reporter: ["text", "json-summary", "html", "lcov"],
      thresholds: { branches: 85, functions: 90, lines: 90, statements: 90 },
    },
  },
});
