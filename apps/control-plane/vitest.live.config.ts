import { readFileSync } from "node:fs";

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const relay = process.env.HOLON_LIVE_RELAY_URL;
if (!relay || !/^http:\/\/127\.0\.0\.1:\d+$/u.test(relay))
  throw new Error("Start the authorized live benchmark CLI first");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          AGENT_TRACE_PAYLOADS: "disabled",
          AI_GATEWAY_ACCOUNT_ID: "benchmark-relay",
          AI_GATEWAY_ID: "benchmark-relay",
          AI_GATEWAY_API_TOKEN: "no-credential-in-workerd",
          AI_MODEL_ID: "dynamic/pr-review",
          LIVE_RELAY_URL: relay,
          LIVE_PROBE: process.env.HOLON_LIVE_PROBE === "true",
          LIVE_DONE: process.env.HOLON_LIVE_DONE ?? "[]",
          LIVE_PARTITION: process.env.HOLON_LIVE_PARTITION ?? "development",
          LIVE_QUALITY_CHECK: process.env.HOLON_LIVE_QUALITY_CHECK === "true",
        },
        serviceBindings: { REPOSITORY_EXECUTOR: "live-fixture-executor" },
        workers: [
          {
            name: "live-fixture-executor",
            compatibilityDate: "2026-08-29",
            modules: true,
            bindings: { LIVE_RELAY_URL: relay },
            script: readFileSync(
              new URL("./evaluation/fixture-worker.mjs", import.meta.url),
              "utf8",
            ),
          },
        ],
      },
    }),
  ],
  test: {
    include: ["evaluation/*.live.ts"],
    fileParallelism: false,
    testTimeout: 900_000,
    reporters: ["default"],
    clearMocks: true,
    restoreMocks: true,
  },
});
