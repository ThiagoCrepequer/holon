import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        bindings: {
          AI_GATEWAY_ACCOUNT_ID: "a".repeat(32),
          AI_GATEWAY_API_TOKEN: "test-gateway-token",
          AI_GATEWAY_ID: "holon",
          AI_MODEL_ID: "dynamic/pr-review",
          SOURCE_REVISION: "a".repeat(40),
          THINK_EVALUATION_API_TOKEN: "test-evaluation-token-long-enough",
        },
      },
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    clearMocks: true,
    coverage: {
      include: ["src/**/*.ts"],
      provider: "istanbul",
      reporter: ["text", "json-summary", "html"],
      thresholds: { branches: 85, functions: 90, lines: 90, statements: 90 },
    },
    mockReset: true,
    restoreMocks: true,
  },
});
