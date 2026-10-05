import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./test/worker.ts",
      miniflare: {
        compatibilityDate: "2026-08-29",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: {
          EFFECT_GATES: { className: "EffectGate", useSQLite: true },
          PROOF_LEDGERS: { className: "ProofLedger", useSQLite: true },
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 10000,
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      reporter: ["text", "json-summary", "lcov"],
      thresholds: { branches: 85, functions: 90, lines: 90, statements: 90 },
    },
  },
});
