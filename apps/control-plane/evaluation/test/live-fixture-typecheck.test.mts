import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

import { liveCodeRegressionFixtures } from "../live-code-regression-fixtures.js";
import { liveConfirmationFixtures } from "../live-confirmation-fixtures.js";
import { liveCoverageRegressionFixtures } from "../live-coverage-regression-fixtures.js";
import { validateFixtureOracle } from "../live-fixture-executor.mjs";
import { validateFixtureTypecheck } from "../live-fixture-typecheck.mjs";
import { liveFixtures, type LiveReviewFixture } from "../live-fixtures.js";
import { liveHoldoutFixtures } from "../live-holdout-fixtures.js";

const fixtures: readonly LiveReviewFixture[] = [
  ...liveFixtures,
  ...liveConfirmationFixtures,
  ...liveCodeRegressionFixtures,
  ...liveCoverageRegressionFixtures,
  ...liveHoldoutFixtures,
];
for (const fixture of fixtures) {
  await test(`the fixture ${fixture.id} compiles and matches its executable label`, async () => {
    const root = await mkdtemp(resolve(tmpdir(), "holon-oracle-"));
    try {
      for (const snapshot of ["base", "head"]) {
        const directory = resolve(root, snapshot);
        await mkdir(resolve(directory, "src"), { recursive: true });
        const files =
          snapshot === "base" && fixture.baseFiles
            ? fixture.baseFiles
            : {
                ...fixture.files,
                "src/producer.ts":
                  snapshot === "base"
                    ? fixture.baseProducer
                    : fixture.headProducer,
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

for (const fixture of liveCoverageRegressionFixtures) {
  await test(`the canonical patch for ${fixture.id} transforms the declared base into the exact head`, async () => {
    const root = await mkdtemp(resolve(tmpdir(), "holon-canonical-oracle-"));
    try {
      await mkdir(resolve(root, "src"));
      for (const [path, content] of Object.entries(fixture.baseFiles))
        await writeFile(resolve(root, path), content);
      const patch = resolve(root, "fixture.patch");
      await writeFile(patch, fixture.patch);
      const options = {
        cwd: root,
        env: {
          ...process.env,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
        },
        timeout: 5000,
      };
      execFileSync("git", ["apply", "--unidiff-zero", "--", patch], options);
      for (const [path, content] of Object.entries(fixture.files))
        assert.equal(await readFile(resolve(root, path), "utf8"), content);
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
