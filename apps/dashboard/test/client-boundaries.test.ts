import { expect, it } from "vitest";

import { assertClientModules } from "../scripts/client-boundaries.js";

it("allows browser/UI modules and denies server module identities independently of minified symbols", () => {
  expect(() =>
    assertClientModules([
      "/workspace/packages/ui/src/button.tsx",
      "/workspace/apps/dashboard/app/root.tsx",
      "/node_modules/react/index.js",
    ]),
  ).not.toThrow();
  for (const id of [
    "/workspace/app/private.server.ts",
    "/workspace/app/private.server.tsx?transform",
    "/workspace/packages/db/src/identity.ts",
    "/workspace/packages/auth/src/index.ts",
    "/node_modules/better-auth/index.js",
    "/node_modules/@better-auth/core/index.js",
    "/node_modules/drizzle-orm/d1/index.js",
    "\0cloudflare:workers",
    "node:crypto",
    "__vite-browser-external:node:fs",
  ]) {
    expect(() => assertClientModules([id])).toThrow(
      "Server module in client bundle",
    );
  }
});
