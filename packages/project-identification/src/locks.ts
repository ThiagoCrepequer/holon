import type { IdentificationFact } from "@holon/contracts";

import { extractFacts, type ParsedSource } from "./facts.js";
import { record, string, rootOf } from "./sources.js";
export function lockFacts(
  source: ParsedSource,
  manifest: ParsedSource,
  root: string,
): IdentificationFact[] {
  const results: IdentificationFact[] = [];
  const direct = {
    ...record(manifest.data.dependencies),
    ...record(manifest.data.devDependencies),
    ...record(manifest.data.optionalDependencies),
  };
  const push = (name: string, value: unknown, selector: string) => {
    const v = string(value);
    if (!v || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/u.test(v)) return;
    results.push({
      id: `lock:${results.length}:${source.path}`,
      path: source.path,
      digest: source.digest,
      name,
      value: v,
      selector,
      kind: "locked",
      condition: null,
      category:
        extractFacts(
          { ...manifest, data: { dependencies: { [name]: v } } },
          "node",
        )[0]?.category ?? "library",
    });
  };
  if (
    /(?:package-lock|npm-shrinkwrap)\.json$/u.test(source.path) &&
    [2, 3].includes(Number(source.data.lockfileVersion))
  ) {
    const packages = record(source.data.packages);
    const lockRoot = rootOf(source.path);
    let importer =
      root === lockRoot
        ? ""
        : root.slice(lockRoot === "." ? 0 : lockRoot.length + 1);
    for (const name of Object.keys(direct)) {
      let path = importer;
      while (true) {
        const key = (path ? path + "/" : "") + "node_modules/" + name;
        const entry = record(packages[key]);
        if (entry.version) {
          push(name, entry.version, `packages.${key}.version`);
          break;
        }
        if (!path) break;
        path = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      }
    }
  } else if (
    source.path.endsWith("pnpm-lock.yaml") &&
    ["6.0", "9.0", "6", "9"].includes(String(source.data.lockfileVersion))
  ) {
    const lockRoot = rootOf(source.path);
    const importer =
      root === lockRoot
        ? "."
        : root.slice(lockRoot === "." ? 0 : lockRoot.length + 1);
    const data = record(record(source.data.importers)[importer]);
    for (const section of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
    ])
      for (const [name, entry] of Object.entries(record(data[section])))
        if (name in direct) {
          const v = string(record(entry).version) ?? string(entry);
          push(
            name,
            v?.split("(")[0],
            `importers.${importer}.${section}.${name}`,
          );
        }
  }
  if (source.path.endsWith("yarn.lock")) {
    for (const [name, spec] of Object.entries(direct)) {
      const selectors = new Set([
        `${name}@${String(spec)}`,
        `${name}@npm:${String(spec)}`,
      ]);
      for (const [key, entry] of Object.entries(source.data)) {
        if (key.split(/,\s*/u).some((part) => selectors.has(part)))
          push(name, record(entry).version, `${key}.version`);
      }
    }
  }
  if (source.path.endsWith("pnpm-workspace.yaml")) {
    for (const [name, spec] of Object.entries(direct)) {
      if (typeof spec !== "string" || !spec.startsWith("catalog:")) continue;
      const catalogName = spec.slice(8);
      const catalog = catalogName
        ? record(record(source.data.catalogs)[catalogName])
        : record(source.data.catalog);
      const value = string(catalog[name]);
      if (value)
        results.push(
          ...extractFacts(
            {
              ...source,
              path: "package.json",
              data: { dependencies: { [name]: value } },
            },
            "node",
          ).map((f) => ({
            ...f,
            path: source.path,
            selector: `catalog${catalogName ? "s." + catalogName : ""}.${name}`,
          })),
        );
    }
  }
  return results;
}
