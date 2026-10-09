import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const compiler = resolve(
  dirname(createRequire(import.meta.url).resolve("typescript/package.json")),
  "bin/tsc",
);

/** This oracle runs only on the synthetic fixture directories materialized by the manual harness. */
export async function validateFixtureTypecheck(
  directory: string,
): Promise<{ readonly passed: true }> {
  const config = resolve(directory, "oracle-tsconfig.json");
  await writeFile(
    config,
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        allowImportingTsExtensions: true,
        types: [],
      },
      include: ["src/**/*.ts"],
    }),
  );
  await execute(process.execPath, [compiler, "--project", config], {
    timeout: 10_000,
    maxBuffer: 10_000,
  });
  return { passed: true };
}
