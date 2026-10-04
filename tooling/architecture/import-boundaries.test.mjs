import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const allowed = {
  "apps/control-plane": [
    "application",
    "contracts",
    "domain",
    "github",
    "model",
    "project-identification",
    "repository-analysis",
    "repository-config",
  ],
  "apps/repository-executor": [
    "contracts",
    "domain",
    "project-identification",
    "repository-analysis",
  ],
  "packages/application": ["contracts", "domain"],
  "packages/contracts": ["domain"],
  "packages/domain": [],
  "packages/evaluation": [
    "application",
    "contracts",
    "model",
    "project-identification",
  ],
  "packages/github": [
    "application",
    "contracts",
    "domain",
    "repository-analysis",
  ],
  "packages/model": ["application", "contracts", "domain"],
  "packages/project-identification": ["application", "contracts"],
  "packages/repository-analysis": ["contracts", "domain"],
  "packages/repository-config": ["application", "contracts"],
  "packages/test-kit": ["contracts"],
};
const allowedPureLayerUtilities = {
  "packages/domain": [],
  "packages/application": ["@renovatebot/pep440", "semver"],
  "packages/contracts": ["zod"],
};

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(filename)));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      files.push(filename);
  }
  return files;
}

function moduleSpecifiers(source) {
  const specifiers = [];
  const pattern = /\b(?:from\s*|import\s*(?:\(\s*)?)["']([^"']+)["']/gu;
  for (const match of source.matchAll(pattern))
    specifiers.push({ text: match[1], position: match.index });
  return specifiers;
}

void test("production imports follow the workspace architecture", async () => {
  const violations = [];
  for (const [workspace, permitted] of Object.entries(allowed)) {
    const manifest = JSON.parse(
      await readFile(path.join(root, workspace, "package.json"), "utf8"),
    );
    const dependencies = Object.keys(manifest.dependencies ?? {})
      .filter((name) => name.startsWith("@holon/"))
      .map((name) => name.slice("@holon/".length))
      .toSorted((left, right) => left.localeCompare(right));
    assert.deepEqual(
      dependencies,
      permitted.toSorted((left, right) => left.localeCompare(right)),
      workspace,
    );
    const directory = path.join(root, workspace, "src");
    for (const filename of await sourceFiles(directory)) {
      const source = await readFile(filename, "utf8");
      for (const specifier of moduleSpecifiers(source)) {
        const imported = specifier.text;
        let reason;
        if (imported.startsWith("@holon/")) {
          if (!permitted.includes(imported.slice("@holon/".length)))
            reason = "workspace edge is not permitted";
        } else if (imported.startsWith(".")) {
          const target = path.relative(
            root,
            path.resolve(path.dirname(filename), imported),
          );
          if (
            /^(apps|packages)\//u.test(target) &&
            !target.startsWith(`${workspace}/`)
          )
            reason = "relative import crosses a workspace";
        } else if (
          Object.hasOwn(allowedPureLayerUtilities, workspace) &&
          !allowedPureLayerUtilities[workspace].includes(imported)
        )
          reason = "core layer imports an unapproved external module";
        if (reason) {
          const line = source.slice(0, specifier.position).split("\n").length;
          violations.push(
            `${path.relative(root, filename)}:${line}: ${imported}: ${reason}`,
          );
        }
      }
    }
  }
  assert.deepEqual(violations, []);
});

void test("production modules have no relative import cycles", async () => {
  const cycles = new Set();
  for (const workspace of Object.keys(allowed)) {
    const directory = path.join(root, workspace, "src");
    const files = await sourceFiles(directory);
    const fileSet = new Set(files);
    const graph = new Map();
    for (const filename of files) {
      const source = await readFile(filename, "utf8");
      const dependencies = moduleSpecifiers(source)
        .map(({ text }) =>
          text.startsWith(".")
            ? path
                .resolve(path.dirname(filename), text)
                .replace(/\.js$/u, ".ts")
            : undefined,
        )
        .filter((target) => target && fileSet.has(target));
      graph.set(filename, dependencies);
    }
    const visited = new Set();
    const active = [];
    const visit = (filename) => {
      const index = active.indexOf(filename);
      if (index !== -1) {
        cycles.add(
          [...active.slice(index), filename]
            .map((name) => path.relative(root, name))
            .join(" -> "),
        );
        return;
      }
      if (visited.has(filename)) return;
      active.push(filename);
      for (const dependency of graph.get(filename) ?? []) visit(dependency);
      active.pop();
      visited.add(filename);
    };
    for (const filename of files) visit(filename);
  }
  assert.deepEqual([...cycles], []);
});

void test("control-plane feature directories form an acyclic graph", async () => {
  const directory = path.join(root, "apps/control-plane/src");
  const features = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const graph = new Map(features.map((feature) => [feature, new Set()]));
  for (const feature of features) {
    for (const filename of await sourceFiles(path.join(directory, feature))) {
      const source = await readFile(filename, "utf8");
      for (const { text } of moduleSpecifiers(source)) {
        if (!text.startsWith(".")) continue;
        const target = path.relative(
          directory,
          path.resolve(path.dirname(filename), text),
        );
        const targetFeature = target.split(path.sep)[0];
        if (targetFeature !== feature && graph.has(targetFeature))
          graph.get(feature).add(targetFeature);
      }
    }
  }
  const visited = new Set();
  const active = [];
  const cycles = new Set();
  const visit = (feature) => {
    const index = active.indexOf(feature);
    if (index !== -1) {
      cycles.add([...active.slice(index), feature].join(" -> "));
      return;
    }
    if (visited.has(feature)) return;
    active.push(feature);
    for (const dependency of graph.get(feature)) visit(dependency);
    active.pop();
    visited.add(feature);
  };
  for (const feature of features) visit(feature);
  assert.deepEqual([...cycles], []);
});
