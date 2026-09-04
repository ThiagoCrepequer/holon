import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig(({ command, isPreview }) => ({
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      // Wrangler filters .dev.vars by secrets.required. Only the dev server
      // accepts these local settings; build and preview keep the deployment config.
      ...(command === "serve" && !isPreview
        ? {
            config: (config) => ({
              secrets: {
                required: [
                  ...(config.secrets?.required ?? []),
                  "DEV_BYPASS_AUTH",
                  "DEV_USER_EMAIL",
                ],
              },
            }),
          }
        : {}),
    }),
    tailwindcss(),
    reactRouter(),
  ],
}));
