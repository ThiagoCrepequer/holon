import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    coverage: {
      include: ["app/**/*.client.tsx"],
      provider: "istanbul",
      reporter: ["text", "json-summary", "html", "lcov"],
      reportsDirectory: "coverage/client",
      thresholds: { branches: 85, functions: 90, lines: 90, statements: 90 },
    },
    environment: "jsdom",
    include: ["test/**/*.client.test.tsx"],
    mockReset: true,
    outputFile: {
      junit: "junit-client.xml",
    },
    reporters: ["default", "junit"],
    restoreMocks: true,
  },
});
