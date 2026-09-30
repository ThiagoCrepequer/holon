import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { mergeConfig } from "vitest/config";

import base from "./vitest.config.js";
const timeout = Number(process.env.HOLON_LOCAL_REVIEW_TIMEOUT_MS);
if (!Number.isSafeInteger(timeout) || timeout <= 0)
  throw new Error(
    "Run the local-review command to configure the execution deadline",
  );
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
            HOLON_LOCAL_REVIEW_ALL:
              process.env.HOLON_LOCAL_REVIEW_ALL ?? "false",
            HOLON_LOCAL_REVIEW_URL: process.env.HOLON_LOCAL_REVIEW_URL ?? "",
            HOLON_LOCAL_REVIEW_CAPABILITY:
              process.env.HOLON_LOCAL_REVIEW_CAPABILITY ?? "",
          },
        },
      }),
    ],
    test: {
      include: ["local-review/**/*.test.ts"],
      testTimeout: timeout,
      coverage: { enabled: false },
    },
  },
);
