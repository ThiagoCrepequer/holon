import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    exclude: ["test/**/*.worker.test.ts"],
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html", "lcov"],
      thresholds: { branches: 85, functions: 90, lines: 90, statements: 90 },
    },
    environment: "node",
    mockReset: true,
    outputFile: {
      junit: "junit.xml",
    },
    reporters: ["default", "junit"],
    restoreMocks: true,
  },
});
