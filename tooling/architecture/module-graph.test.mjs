import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveLocal,
  moduleSpecifiers,
  inspectModules,
} from "./module-graph.mjs";
void test("architecture resolves .js imports to TSX so cycles and server leakage cannot hide", () => {
  const files = new Set(["/fixture/app/page.tsx", "/fixture/app/other.tsx"]);
  assert.equal(
    resolveLocal("/fixture/app/page.tsx", "./other.js", files),
    "/fixture/app/other.tsx",
  );
});

function inspect(input) {
  const sources = new Map(
    Object.entries(input).map(([name, content]) => [
      `/fixture/${name}`,
      content,
    ]),
  );
  return inspectModules({
    root: "/fixture",
    sources,
    allowed: {
      "apps/dashboard": ["ui", "db", "contracts"],
      "packages/ui": [],
      "packages/db": [],
      "packages/contracts": [],
    },
    manifests: new Map([
      ["packages/ui", { exports: { "./button": "./src/button.tsx" } }],
      [
        "packages/db",
        { exports: { "./identity/server": "./src/identity.server.ts" } },
      ],
      ["packages/contracts", { exports: { ".": "./src/index.ts" } }],
    ]),
  });
}
void test("AST extracts real static, dynamic and type imports without strings/comment false positives", () => {
  const values = moduleSpecifiers(`// import("fake")
const text='from "fake"';
import x from "one"; export { x } from "two"; void import("three"); type T=import("four").Type;`);
  assert.deepEqual(
    values.map((value) => value.text),
    ["one", "two", "three", "four"],
  );
});
void test("allowed subpaths and feature interfaces pass, unknown packages/exports and inverse edges fail", () => {
  assert.deepEqual(
    inspect({
      "apps/dashboard/app/routes/welcome/route.tsx":
        'import { Button } from "@holon/ui/button"; import { result } from "../../features/reviews/public.js";',
      "apps/dashboard/app/features/reviews/public.ts": "export const result=1;",
      "packages/ui/src/button.tsx": "export const Button=1;",
    }).violations,
    [],
  );
  for (const source of [
    'import x from "@holon/ui";',
    'import x from "@holon/missing";',
    'import x from "@holon/ui/missing";',
    'import x from "@holon/ui/src/private";',
    'import x from "../../../../packages/ui/src/button.js";',
    'import x from "drizzle-orm";',
  ])
    assert(
      inspect({ "apps/dashboard/app/routes/welcome/route.tsx": source })
        .violations.length > 0,
    );
  assert(
    inspect({
      "packages/ui/src/component.tsx":
        'import x from "../../../apps/dashboard/app/root.js";',
    }).violations.length > 0,
  );
});
void test("routes cannot import sibling internals and features cannot reach routes or other internals", () => {
  for (const input of [
    {
      "apps/dashboard/app/routes/a/route.tsx": 'import x from "../b/page.js";',
      "apps/dashboard/app/routes/b/page.tsx": "export default 1;",
    },
    {
      "apps/dashboard/app/features/a/public.ts":
        'import x from "../../routes/b/page.js";',
      "apps/dashboard/app/routes/b/page.tsx": "export default 1;",
    },
    {
      "apps/dashboard/app/features/a/public.ts":
        'import x from "../b/private.js";',
      "apps/dashboard/app/features/b/private.ts": "export default 1;",
    },
    {
      "apps/dashboard/app/features/a/public.ts":
        'import x from "../../routes/not-found.js";',
      "apps/dashboard/app/routes/not-found.tsx": "export default 1;",
    },
    {
      "apps/dashboard/app/routes/a/route.tsx":
        'import x from "../not-found.js";',
      "apps/dashboard/app/routes/not-found.tsx": "export default 1;",
    },
    {
      "apps/dashboard/app/features/a/public.ts":
        'import x from "../../root.js";',
      "apps/dashboard/app/root.tsx": "export default 1;",
    },
  ])
    assert(inspect(input).violations.length > 0);
});
void test("transitive server imports and alias TSX cycles fail even through local wrappers", () => {
  const leaked = inspect({
    "apps/dashboard/app/routes/a/page.tsx": 'import x from "~/shared.js";',
    "apps/dashboard/app/shared.ts":
      'import x from "@holon/db/identity/server";',
    "packages/db/src/identity.server.ts": "export default 1;",
  });
  assert(
    leaked.violations.some((value) =>
      value.includes("browser imports server code"),
    ),
  );
  const cycle = inspect({
    "apps/dashboard/app/routes/a/page.tsx":
      'import x from "~/routes/a/other.js";',
    "apps/dashboard/app/routes/a/other.tsx": 'export { x } from "./page.js";',
  });
  assert(cycle.cycles.length > 0);
});

void test("browser wrappers cannot hide runtime/ORM/server SDK imports; framework route loaders remain mixed modules", () => {
  for (const specifier of [
    "cloudflare:workers",
    "node:crypto",
    "drizzle-orm/d1",
    "better-auth",
    "react-dom/server",
  ]) {
    const result = inspect({
      "packages/ui/src/button.tsx": 'import x from "./shared.js";',
      "packages/ui/src/shared.ts": `import x from "${specifier}";`,
    });
    assert(
      result.violations.some((value) =>
        value.includes("browser imports server dependency"),
      ),
    );
  }
  assert.deepEqual(
    inspect({
      "apps/dashboard/app/routes/a/route.tsx":
        'import x from "./loader.server.js";',
      "apps/dashboard/app/routes/a/loader.server.ts": "export default 1;",
    }).violations,
    [],
  );
  // The build checks the framework's removal of server imports from route modules.
  assert(
    inspect({
      "apps/dashboard/app/routes/a/page.tsx":
        'import x from "./loader.server.js";',
      "apps/dashboard/app/routes/a/loader.server.ts": "export default 1;",
    }).violations.length > 0,
  );
});

void test("computed imports cannot evade an explicit package boundary", () => {
  const result = inspect({
    "packages/ui/src/button.tsx":
      "export const load=(module: string)=>import(module);",
  });
  assert(result.violations.some((value) => value.includes("computed import")));
});
