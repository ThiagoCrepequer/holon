import { fileURLToPath } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

import { assertClientModules } from "./scripts/client-boundaries.js";
const clientBoundaries: Plugin = {
  name: "holon-client-boundaries",
  apply: "build",
  generateBundle(_options, bundle) {
    if (this.environment.name !== "client") return;
    const modules = Object.values(bundle).flatMap((output) =>
      output.type === "chunk" ? Object.keys(output.modules) : [],
    );
    if (modules.length === 0) throw new Error("Client module metadata missing");
    assertClientModules(modules);
    console.log(
      `Dashboard client: ${modules.length} module identities checked before minification.`,
    );
  },
};
export default defineConfig({
  resolve: { alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) } },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
    clientBoundaries,
  ],
});
