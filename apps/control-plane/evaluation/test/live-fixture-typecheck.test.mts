import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

import { liveCodeRegressionFixtures } from "../live-code-regression-fixtures.js";
import { liveConfirmationFixtures } from "../live-confirmation-fixtures.js";
import { validateFixtureOracle } from "../live-fixture-executor.mjs";
import { validateFixtureTypecheck } from "../live-fixture-typecheck.mjs";
import { liveFixtures } from "../live-fixtures.js";
import { liveHoldoutFixtures } from "../live-holdout-fixtures.js";

for (const fixture of [
  ...liveFixtures,
  ...liveConfirmationFixtures,
  ...liveCodeRegressionFixtures,
  ...liveHoldoutFixtures,
]) {
  await test(`the fixture ${fixture.id} compiles and matches its executable label`, async () => {
    const root = await mkdtemp(resolve(tmpdir(), "holon-oracle-"));
    try {
      for (const snapshot of ["base", "head"]) {
        const directory = resolve(root, snapshot);
        await mkdir(resolve(directory, "src"), { recursive: true });
        const files = {
          ...fixture.files,
          "src/producer.ts":
            snapshot === "base" ? fixture.baseProducer : fixture.headProducer,
        };
        for (const [path, source] of Object.entries(files))
          await writeFile(resolve(directory, path), source);
        assert.deepEqual(await validateFixtureTypecheck(directory), {
          passed: true,
        });
        assert.deepEqual(
          await validateFixtureOracle(
            directory,
            snapshot === "head" && fixture.positive,
          ),
          { executed: true, failed: snapshot === "head" && fixture.positive },
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

await test("the typecheck oracle rejects a fixture with a static type error", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "holon-oracle-invalid-"));
  try {
    await mkdir(resolve(directory, "src"));
    await writeFile(
      resolve(directory, "src/producer.ts"),
      "export const value: string = 1;\n",
    );
    await assert.rejects(validateFixtureTypecheck(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
