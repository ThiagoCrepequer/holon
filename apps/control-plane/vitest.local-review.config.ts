import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { mergeConfig } from "vitest/config";

import base from "./vitest.config.js";
export default mergeConfig(
  { ...base, plugins: [] },
  {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          serviceBindings: { REPOSITORY_EXECUTOR: "local-executor-binding" },
          workers: [
            {
              name: "local-executor-binding",
              compatibilityDate: "2026-08-29",
              modules: true,
              bindings: {
                URL: process.env.HOLON_LOCAL_REVIEW_URL ?? "",
                CAPABILITY: process.env.HOLON_LOCAL_REVIEW_CAPABILITY ?? "",
              },
              script: `import { WorkerEntrypoint } from "cloudflare:workers"; export default class extends WorkerEntrypoint { async cleanup() {
                const response = await fetch(this.env.URL + "/cleanup", {method:"POST",headers:{authorization:"Bearer " + this.env.CAPABILITY}});
                if(!response.ok) throw new Error("Local cleanup failed");
              } }`,
            },
          ],
          bindings: {
            HOLON_LOCAL_REVIEW_LIVE:
              process.env.HOLON_LOCAL_REVIEW_LIVE ?? "false",
            HOLON_LOCAL_REVIEW_URL: process.env.HOLON_LOCAL_REVIEW_URL ?? "",
            HOLON_LOCAL_REVIEW_CAPABILITY:
              process.env.HOLON_LOCAL_REVIEW_CAPABILITY ?? "",
          },
        },
      }),
    ],
    test: {
      include: ["local-review/**/*.test.ts"],
      testTimeout: 300_000,
      coverage: { enabled: false },
    },
  },
);
