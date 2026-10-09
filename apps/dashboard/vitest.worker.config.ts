import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-08-29",
        d1Databases: ["IDENTITY_DB"],
        bindings: {
          IDENTITY_MIGRATIONS: await readD1Migrations(
            "../../packages/db/migrations/identity",
          ),
        },
      },
    }),
  ],
  test: {
    reporters: ["default", "junit"],
    outputFile: { junit: "junit.workers.xml" },
    include: [
      "test/http-security.test.ts",
      "test/http-composition-review.test.ts",
      "test/http-session-preferences.test.ts",
      "test/viewer.test.ts",
      "test/http-collaboration.test.ts",
      "test/collaboration-composition.worker.ts",
      "test/email-publisher.worker.ts",
    ],
    fileParallelism: false,
    coverage: {
      provider: "istanbul" as const,
      include: ["app/server/**/*.ts"],
      reporter: ["text", "json-summary", "lcov"],
      thresholds: { branches: 85, functions: 90, lines: 90, statements: 90 },
      reportsDirectory: "coverage/workers",
    },
  },
}));
