import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: {
        durableObjects: { SANDBOXES: "HolonSandbox" },
        compatibilityDate: "2026-08-29",
        compatibilityFlags: ["nodejs_compat"],
      },
    }),
  ],
  test: {
    name: "workerd",
    clearMocks: true,
    include: ["test/**/*.worker.test.ts"],
    mockReset: true,
    restoreMocks: true,
  },
});
