import { parseSyml } from "@yarnpkg/parsers";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import {
  parseTree,
  getNodeValue,
  type Node as JsonNode,
  type ParseError,
} from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import { parseDocument, visit, isAlias } from "yaml";
export function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function string(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}
export function list(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
function checkJson(node: JsonNode, depth = 0): void {
  if (depth > 40) throw new Error("depth-limit");
  if (node.type === "object") {
    const names = new Set<string>();
    for (const child of node.children ?? []) {
      const name = String(child.children?.[0]?.value);
      if (names.has(name)) throw new Error("duplicate-key");
      names.add(name);
    }
  }
  for (const child of node.children ?? []) checkJson(child, depth + 1);
}
function bound(value: unknown, depth = 0): void {
  if (depth > 40) throw new Error("depth-limit");
  if (value && typeof value === "object")
    for (const item of Object.values(value)) bound(item, depth + 1);
}
export function parseSource(
  path: string,
  content: string,
): Record<string, unknown> {
  let result: unknown;
  if (path.endsWith("yarn.lock")) {
    if (content.includes("# yarn lockfile v1")) result = parseSyml(content);
    else {
      const doc = parseDocument(content, { uniqueKeys: true });
      if (doc.errors.length) throw new Error("invalid-yarn");
      visit(doc, (_key, node) => {
        if (isAlias(node)) throw new Error("unsafe-yarn");
      });
      result = doc.toJS({ maxAliasCount: 0 });
      if (!record(result)["__metadata"]) throw new Error("unsupported-yarn");
    }
  } else if (path.endsWith(".json")) {
    const errors: ParseError[] = [];
    const tree = parseTree(content, errors, {
      allowTrailingComma: path.endsWith("tsconfig.json"),
      disallowComments: !path.includes("tsconfig"),
    });
    if (!tree || errors.length) throw new Error("invalid-json");
    checkJson(tree);
    result = getNodeValue(tree);
  } else if (
    path.endsWith(".yaml") ||
    path.endsWith(".yml") ||
    path.endsWith("pnpm-lock.yaml")
  ) {
    const doc = parseDocument(content, { uniqueKeys: true });
    if (doc.errors.length) throw new Error("invalid-yaml");
    visit(doc, (_key, node) => {
      if (
        isAlias(node) ||
        (typeof node === "object" && node !== null && "tag" in node && node.tag)
      )
        throw new Error("unsafe-yaml");
    });
    result = doc.toJS({ maxAliasCount: 0 });
  } else if (
    path.endsWith(".toml") ||
    path.endsWith("uv.lock") ||
    path.endsWith("poetry.lock")
  ) {
    result = parseToml(content);
  } else if (path.endsWith(".xml")) {
    if (
      /<!DOCTYPE|<!ENTITY/iu.test(content) ||
      XMLValidator.validate(content) !== true
    )
      throw new Error("unsafe-xml");
    result = new XMLParser({
      ignoreAttributes: false,
      parseTagValue: false,
      processEntities: false,
      isArray: (_name, jpath) =>
        /(?:\.dependency|\.profile|\.plugin|\.module)$/u.test(String(jpath)),
    }).parse(content) as unknown;
  } else return {};
  bound(result);
  return record(result);
}
export const sourceNames = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "yarn.lock",
  "pom.xml",
  "toolchains.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "gradle.properties",
  "gradle.lockfile",
  "libs.versions.toml",
  "pyproject.toml",
  "uv.lock",
  "poetry.lock",
  "requirements.txt",
  "constraints.txt",
  ".python-version",
  ".node-version",
  ".nvmrc",
  ".tool-versions",
  "tsconfig.json",
]);
export function isMetadataPath(path: string): boolean {
  return (
    sourceNames.has(path.split("/").at(-1) ?? "") ||
    /(?:^|\/)tsconfig\.[\w.-]+\.json$/u.test(path)
  );
}
export function rootOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "." : path.slice(0, i);
}
export function under(path: string, root: string): boolean {
  return root === "." || path.startsWith(root + "/");
}
export function localPath(root: string, relative: string): string | undefined {
  if (
    relative.startsWith("/") ||
    relative.includes("\\") ||
    Array.from(relative).some((c) => c.charCodeAt(0) < 32)
  )
    return undefined;
  const parts = root === "." ? [] : root.split("/");
  for (const part of relative.split("/")) {
    if (part === "..") {
      if (!parts.length) return undefined;
      parts.pop();
    } else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/");
}
