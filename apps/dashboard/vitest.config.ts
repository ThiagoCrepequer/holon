import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    reporters: ["default", "junit"],
    outputFile: { junit: "junit.xml" },
    environment: "node",
    include: ["test/**/*.test.ts"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: [
        "app/server/**/*.ts",
        "app/i18n/**/*.ts",
        "scripts/client-boundaries.ts",
      ],
      reporter: ["text", "json-summary", "lcov"],
      thresholds: { branches: 85, functions: 90, lines: 90, statements: 90 },
    },
  },
});
