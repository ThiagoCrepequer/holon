import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        serviceBindings: {
          REPOSITORY_EXECUTOR: () =>
            new Response("executor test stub", { status: 501 }),
        },
      },
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    clearMocks: true,
    coverage: {
      provider: "istanbul",
      reporter: ["text", "json-summary", "html"],
      thresholds: { branches: 85, functions: 90, lines: 90, statements: 90 },
    },
    mockReset: true,
    restoreMocks: true,
  },
});
