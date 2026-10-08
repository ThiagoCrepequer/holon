import { readD1Migrations } from "@cloudflare/vitest-plugin";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-08-29",
        d1Databases: ["IDENTITY_DB", "PROJECTION_DB"],
        bindings: {
          IDENTITY_MIGRATIONS: await readD1Migrations("migrations/identity"),
          PROJECTION_MIGRATIONS: await readD1Migrations(
            "migrations/projection",
          ),
        },
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
}));
