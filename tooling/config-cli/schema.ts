import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { repositoryConfigInputSchema } from "@holon/contracts";
import { format } from "oxfmt";
import { z } from "zod";

const root = new URL("../../", import.meta.url);
const schema = {
  ...z.toJSONSchema(repositoryConfigInputSchema, {
    target: "draft-07",
    io: "input",
  }),
  $id: "urn:holon:repository-configuration",
  examples: [
    { output: { language: "en" } },
    {
      instructions: [
        "Check error handling.",
        { path: "docs/review-guidance.md" },
      ],
    },
  ],
};
const formatted = await format("holon.schema.json", JSON.stringify(schema), {
  printWidth: 80,
  endOfLine: "lf",
});
if (formatted.errors.length)
  throw new Error("Could not format generated schema");
const inputs = [
  "packages/contracts/src/repository-config/input.ts",
  "packages/contracts/src/repository-config/snapshot.ts",
  "packages/contracts/src/review-guidance.ts",
  "packages/application/src/repository-configuration.ts",
  "packages/application/src/configuration-projections.ts",
  "packages/application/src/configuration-compatibility.ts",
  "packages/domain/src/configuration-scope.ts",
  "packages/domain/src/repository-policy.ts",
  "packages/repository-config/src/index.ts",
  "packages/model/src/configuration-guidance.ts",
  "pnpm-lock.yaml",
];
const hash = createHash("sha256");
for (const path of inputs)
  hash
    .update(path + "\0")
    .update(await readFile(new URL(path, root)))
    .update("\0");
const compilerIdentity = `/** Generated from compiler inputs by config:schema:generate. */\nexport const configurationCompilerIdentity =\n  "${hash.digest("hex")}";\n`;
for (const [relative, content] of [
  ["docs/contracts/holon.schema.json", formatted.code],
  [
    "packages/contracts/src/repository-config/compiler-identity.ts",
    compilerIdentity,
  ],
] as const) {
  const path = fileURLToPath(new URL(relative, root));
  if (process.argv.includes("--check")) {
    if ((await readFile(path, "utf8")) !== content)
      throw new Error(
        "Generated configuration artifacts are stale; run pnpm config:schema:generate",
      );
  } else await writeFile(path, content);
}
