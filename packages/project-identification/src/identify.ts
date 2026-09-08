import {
  projectIdentificationResultSchema,
  type IdentificationFact,
  type IdentifiedProject,
  type ProjectIdentificationResult,
} from "@holon/contracts";

import { extractFacts, type ParsedSource } from "./facts.js";
import { lockFacts } from "./locks.js";
import {
  isMetadataPath,
  localPath,
  parseSource,
  record,
  rootOf,
  string,
  under,
} from "./sources.js";
export const detectorRevision = "project-identification-v1";
export async function digest(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export interface SnapshotInput {
  snapshotSha: string;
  files: readonly { path: string; content: string }[];
  policyDigest: string;
  modelRevision: string;
  changedPaths?: readonly string[];
  limitations?: readonly string[];
}
function ecosystem(path: string): IdentifiedProject["ecosystem"] | undefined {
  if (path.endsWith("package.json") && !path.endsWith("package-lock.json"))
    return "node";
  if (path.endsWith("pom.xml")) return "maven";
  if (/(?:^|\/)build\.gradle(?:\.kts)?$/u.test(path)) return "gradle";
  if (path.endsWith("pyproject.toml") || path.endsWith("requirements.txt"))
    return "python";
  return undefined;
}
function nearestSources(
  root: string,
  all: ParsedSource[],
  eco: string,
): ParsedSource[] {
  const sources = all.filter((s) => rootOf(s.path) === root);
  let parent = root;
  while (parent !== ".") {
    parent = rootOf(parent);
    for (const s of all.filter((x) => rootOf(x.path) === parent)) {
      const name = s.path.split("/").at(-1);
      if (
        eco === "node" &&
        [
          "package.json",
          ".tool-versions",
          "pnpm-workspace.yaml",
          "pnpm-lock.yaml",
          "package-lock.json",
          "npm-shrinkwrap.json",
          "yarn.lock",
          ".nvmrc",
          ".node-version",
        ].includes(name ?? "")
      )
        sources.push(s);
      if (
        eco === "python" &&
        [
          "uv.lock",
          ".python-version",
          ".tool-versions",
          "pyproject.toml",
        ].includes(name ?? "")
      )
        sources.push(s);
      if (
        eco === "gradle" &&
        [
          "gradle.properties",
          "settings.gradle",
          "settings.gradle.kts",
          "gradle.lockfile",
        ].includes(name ?? "")
      )
        sources.push(s);
    }
  }
  if (eco === "gradle")
    for (const s of all)
      if (
        s.path ===
        (root === "." ? "" : root + "/") + "gradle/libs.versions.toml"
      )
        sources.push(s);
  return sources;
}
function mavenParents(
  source: ParsedSource,
  all: ParsedSource[],
  seen = new Set<string>(),
): ParsedSource[] {
  if (seen.has(source.path)) return [];
  seen.add(source.path);
  const parent = record(record(source.data.project).parent);
  if (!parent.artifactId) return [];
  const relative =
    parent.relativePath === undefined
      ? "../pom.xml"
      : string(parent.relativePath);
  if (!relative) return [];
  const path = localPath(rootOf(source.path), relative);
  const target = all.find((s) => s.path === path);
  if (!target) return [];
  const candidate = record(target.data.project),
    inherited = record(candidate.parent);
  if (
    candidate.artifactId !== parent.artifactId ||
    (parent.groupId !== undefined &&
      (candidate.groupId ?? inherited.groupId) !== parent.groupId) ||
    (parent.version !== undefined &&
      (candidate.version ?? inherited.version) !== parent.version)
  )
    return [];
  return [...mavenParents(target, all, seen), target];
}
export async function identifySnapshot(
  input: SnapshotInput,
): Promise<ProjectIdentificationResult> {
  const limitations = [...(input.limitations ?? [])];
  const parsed: ParsedSource[] = [];
  const files = input.files
    .filter((f) => isMetadataPath(f.path))
    .toSorted((a, b) => a.path.localeCompare(b.path));
  const errors = new Map<string, string>();
  let totalBytes = 0;
  for (const f of files.slice(0, 2000)) {
    totalBytes += new TextEncoder().encode(f.content).length;
    if (totalBytes > 16777216) {
      limitations.push("metadata-total-limit");
      break;
    }
    const hash = await digest(f.content);
    let data: Record<string, unknown> = {};
    try {
      if (
        new TextEncoder().encode(f.content).length >
        (/lock/u.test(f.path) ? 2097152 : 65536)
      )
        throw new Error("source-size-limit");
      data = parseSource(f.path, f.content);
    } catch {
      errors.set(f.path, "source-unreadable");
    }
    parsed.push({ ...f, digest: hash, data });
  }
  if (files.length > 2000) limitations.push("inventory-truncated");
  const inventoryDigest = await digest(
    JSON.stringify(files.map((f) => f.path)),
  );
  const projects: IdentifiedProject[] = [];
  const keys = new Set<string>();
  const roots = parsed.filter((s) => ecosystem(s.path));
  for (const manifest of roots) {
    const eco = ecosystem(manifest.path)!;
    const root = rootOf(manifest.path);
    const id = `${eco}:${root}`;
    if (keys.has(id)) continue;
    keys.add(id);
    const sources = nearestSources(root, parsed, eco);
    const parents = eco === "maven" ? mavenParents(manifest, parsed) : [];
    for (const p of parents) if (!sources.includes(p)) sources.push(p);
    // Include local tsconfig extends; cycles terminate and remain explicit.
    for (let i = 0; i < sources.length && i < 2000; i++) {
      const s = sources[i]!;
      const ext = string(s.data.extends);
      if (eco === "node" && ext?.startsWith(".")) {
        const path = localPath(
          rootOf(s.path),
          ext.endsWith(".json") ? ext : ext + ".json",
        );
        const target = parsed.find((p) => p.path === path);
        if (target && !sources.includes(target)) sources.push(target);
      }
    }
    const sourcePaths = sources
      .map((s) => s.path)
      .toSorted((a, b) => a.localeCompare(b));
    if (
      input.changedPaths &&
      !input.changedPaths.some(
        (p) =>
          sourcePaths.includes(p) ||
          (under(p, root) &&
            !roots.some(
              (m) =>
                rootOf(m.path) !== root &&
                under(rootOf(m.path), root) &&
                under(p, rootOf(m.path)),
            )),
      )
    )
      continue;
    if (projects.length >= 20) {
      limitations.push("project-limit");
      break;
    }
    const problems = sources
      .filter((s) => errors.has(s.path))
      .map((s) => `${errors.get(s.path)}:${s.path}`);
    const props: Record<string, string> = {};
    for (const s of [...parents, manifest])
      for (const [k, v] of Object.entries(
        record(record(s.data.project).properties),
      )) {
        const text = string(v);
        if (text) props[k] = text;
      }
    let facts: IdentificationFact[] = [];
    for (const s of sources) {
      if (errors.has(s.path)) continue;
      // Ancestor manifests contribute inherited Maven properties, not arbitrary dependencies.
      if (eco === "maven" && s.path.endsWith("pom.xml") && s !== manifest)
        continue;
      if (eco === "node" && s.path.endsWith("package.json") && s !== manifest) {
        facts.push(
          ...extractFacts(s, eco, props).filter(
            (f) => f.category === "package-manager",
          ),
        );
        continue;
      }
      if (
        eco === "python" &&
        s.path.endsWith("pyproject.toml") &&
        s !== manifest
      )
        continue;
      const extracted = extractFacts(s, eco, props);
      const directNames = new Set(
        extractFacts(manifest, eco, props).map((f) => f.name),
      );
      facts.push(
        ...(eco === "python" && /(?:uv|poetry)\.lock$/u.test(s.path)
          ? extracted.filter((f) => directNames.has(f.name))
          : extracted),
      );
      if (eco === "node") {
        facts.push(...lockFacts(s, manifest, root));
        if (
          /(?:package-lock|npm-shrinkwrap)\.json$/u.test(s.path) &&
          ![2, 3].includes(Number(s.data.lockfileVersion))
        )
          problems.push("unsupported-npm-lock-version");
        if (
          s.path.endsWith("pnpm-lock.yaml") &&
          !["6", "6.0", "9", "9.0"].includes(String(s.data.lockfileVersion))
        )
          problems.push("unsupported-pnpm-lock-version");
      }
      if (s.path.endsWith("yarn.lock") && !Object.keys(s.data).length)
        problems.push("unsupported-format:yarn-lock");
    }
    if (eco === "maven") {
      const pom = record(manifest.data.project);
      if (record(pom.parent).artifactId && !parents.length)
        problems.push("external-parent-unresolved");
      if (pom.profiles) problems.push("profile-activation-unknown");
      // Property derivation must retain the parent source in evidence.
      for (const s of parents)
        facts.push(
          ...extractFacts(s, "maven", props).filter(
            (f) =>
              f.name === "java" ||
              f.selector.startsWith("project.dependencyManagement") ||
              f.selector.startsWith("project.parent"),
          ),
        );
    }
    if (eco === "gradle") problems.push("build-script-not-evaluated");
    if (eco === "python" && sources.some((s) => s.path.endsWith(".lock")))
      problems.push("environment-selection-unknown");
    if (facts.length > 500) problems.push("fact-limit");
    facts = facts.slice(0, 500).map((f, i) => ({ ...f, id: `fact-${i}` }));
    const technologies: IdentifiedProject["technologies"] = [];
    for (const f of facts) {
      let t = technologies.find((technology) => technology.name === f.name);
      if (!t) {
        if (technologies.length >= 100) {
          problems.push("technology-limit");
          break;
        }
        t = { name: f.name, category: f.category, declarations: [] };
        technologies.push(t);
      }
      if (t.declarations.length < 100)
        t.declarations.push({
          value: f.value,
          kind: f.kind,
          evidenceIds: [f.id],
          condition: f.condition,
        });
    }
    const fingerprint = await digest(
      JSON.stringify({
        revision: detectorRevision,
        model: input.modelRevision,
        policy: input.policyDigest,
        id,
        inventory: files
          .filter((f) => under(f.path, root) || sourcePaths.includes(f.path))
          .map((f) => f.path),
        sources: sources
          .map((s) => [s.path, s.digest])
          .toSorted((a, b) => String(a).localeCompare(String(b))),
        problems,
        limitations,
      }),
    );
    projects.push({
      id,
      root,
      ecosystem: eco,
      fingerprint,
      status: problems.length ? "partial" : "complete",
      sourcePaths,
      facts,
      technologies,
      limitations: [...new Set(problems)].slice(0, 100),
      interpretation: "deterministic",
    });
  }
  while (new TextEncoder().encode(JSON.stringify(projects)).length > 200000) {
    projects.pop();
    limitations.push("result-size-limit");
  }
  return projectIdentificationResultSchema.parse({
    snapshotSha: input.snapshotSha,
    inventoryDigest,
    detectorRevision,
    projects,
    status:
      limitations.length || projects.some((p) => p.status !== "complete")
        ? "partial"
        : "complete",
    limitations: [...new Set(limitations)].slice(0, 100),
  });
}
