import path from "node:path";

import { parse } from "@babel/parser";

export function moduleSpecifiers(source, filename = "module.ts") {
  const parsed = parse(source, {
    sourceType: "module",
    sourceFilename: filename,
    attachComment: false,
    plugins: filename.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
  });
  const specifiers = [];
  const add = (node) => {
    if (node?.type === "StringLiteral")
      specifiers.push({ text: node.value, position: node.start });
    else if (node)
      specifiers.push({
        text: "<computed import>",
        position: node.start,
        computed: true,
      });
  };
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (
      [
        "ImportDeclaration",
        "ExportNamedDeclaration",
        "ExportAllDeclaration",
        "ImportExpression",
      ].includes(node.type)
    )
      add(node.source);
    if (node.type === "CallExpression" && node.callee.type === "Import")
      add(node.arguments[0]);
    if (node.type === "TSImportType") add(node.source);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value?.type) visit(value);
    }
  };
  visit(parsed);
  return specifiers;
}
export function resolveLocal(filename, specifier, fileSet, appDirectory) {
  const stem =
    specifier.startsWith("~/") && appDirectory
      ? path.resolve(appDirectory, specifier.slice(2))
      : path.resolve(path.dirname(filename), specifier);
  const withoutJs = stem.replace(/\.[cm]?jsx?$/u, "");
  return [
    stem,
    `${withoutJs}.ts`,
    `${withoutJs}.tsx`,
    `${stem}/index.ts`,
    `${stem}/index.tsx`,
  ].find((candidate) => fileSet.has(candidate));
}
export function findCycles(graph) {
  const cycles = new Set();
  const visited = new Set();
  const active = [];
  const visit = (file) => {
    const index = active.indexOf(file);
    if (index !== -1) {
      cycles.add([...active.slice(index), file].join(" -> "));
      return;
    }
    if (visited.has(file)) return;
    active.push(file);
    for (const dependency of graph.get(file) ?? []) visit(dependency);
    active.pop();
    visited.add(file);
  };
  for (const file of graph.keys()) visit(file);
  return [...cycles];
}
function workspaceOf(root, file) {
  return path.relative(root, file).split(path.sep).slice(0, 2).join("/");
}
function isBrowserEntry(file) {
  return (
    /packages\/ui\/src\//u.test(file) ||
    /\.client\.[tj]sx?$/u.test(file) ||
    (/apps\/dashboard\/app\/(?:features|shell|routes)\//u.test(file) &&
      file.endsWith(".tsx") &&
      !/\.server\./u.test(file) &&
      !file.endsWith("/route.tsx"))
  );
}
function privateBoundary(from, target) {
  const sourceFeature = from.match(/\/app\/features\/([^/]+)\//u)?.[1];
  const targetFeature = target.match(/\/app\/features\/([^/]+)\//u)?.[1];
  const sourceRoute = from
    .match(/\/app\/routes\/([^/]+)(?:\/|$)/u)?.[1]
    ?.replace(/\.[cm]?[tj]sx?$/u, "");
  const targetRoute = target
    .match(/\/app\/routes\/([^/]+)(?:\/|$)/u)?.[1]
    ?.replace(/\.[cm]?[tj]sx?$/u, "");
  if (sourceFeature && targetRoute) return "feature imports a route";
  if (
    sourceFeature &&
    (/\/app\/(?:root|routes|composition\.server)\.[tj]sx?$/u.test(target) ||
      /\/app\/shell\//u.test(target))
  )
    return "feature imports app composition";
  if (sourceRoute && targetRoute && sourceRoute !== targetRoute)
    return "route imports another route's internals";
  if (
    targetFeature &&
    targetFeature !== sourceFeature &&
    !target.endsWith("/public.ts")
  )
    return "import bypasses a feature public interface";
  return undefined;
}
export function inspectModules({ root, sources, manifests, allowed }) {
  const files = new Set(sources.keys());
  const graph = new Map();
  const serverDependencies = new Map();
  const violations = [];
  for (const [filename, source] of sources) {
    const workspace = workspaceOf(root, filename);
    const dependencies = [];
    const serverImports = [];
    for (const { text, position, computed } of moduleSpecifiers(
      source,
      filename,
    )) {
      let reason = computed
        ? "computed import bypasses static module boundaries"
        : undefined;
      let target;
      if (
        /^(?:cloudflare:|node:|better-auth(?:\/|$)|@better-auth\/|drizzle-orm(?:\/|$)|react-dom\/server)/u.test(
          text,
        )
      )
        serverImports.push(text);
      if (text.startsWith("@holon/")) {
        const [, name, subpath = ""] =
          text.match(/^@holon\/([^/]+)(\/.*)?$/u) ?? [];
        const targetWorkspace = `packages/${name}`;
        if (!(allowed[workspace] ?? []).includes(name))
          reason = "workspace edge is not permitted";
        else {
          const exported =
            manifests.get(targetWorkspace)?.exports?.[
              subpath ? `.${subpath}` : "."
            ];
          if (typeof exported !== "string") reason = "unknown package export";
          else if (
            targetWorkspace === "packages/db" &&
            subpath === "/auth-integration/server" &&
            workspace !== "packages/auth"
          ) {
            reason =
              "auth-integration ORM export is reserved for packages/auth";
          } else target = path.resolve(root, targetWorkspace, exported);
        }
      } else if (text.startsWith(".") || text.startsWith("~/")) {
        target = resolveLocal(
          filename,
          text,
          files,
          path.resolve(root, workspace, "app"),
        );
        const candidate = text.startsWith("~/")
          ? path.resolve(root, workspace, "app", text.slice(2))
          : path.resolve(path.dirname(filename), text);
        const destination = workspaceOf(root, candidate);
        if (
          /^(apps|packages)\//u.test(destination) &&
          destination !== workspace
        )
          reason = "relative import crosses a workspace";
      }
      if (target && !reason) reason = privateBoundary(filename, target);
      if (
        /apps\/dashboard\//u.test(filename) &&
        /^(?:better-auth|@better-auth\/|drizzle-orm|lucide-react|@radix-ui\/)/u.test(
          text,
        )
      )
        reason = "external integration belongs to its package";
      if (reason)
        violations.push(
          `${path.relative(root, filename)}:${source.slice(0, position).split("\n").length}: ${text}: ${reason}`,
        );
      if (target && files.has(target)) dependencies.push(target);
    }
    graph.set(filename, dependencies);
    serverDependencies.set(filename, serverImports);
  }
  for (const filename of sources.keys()) {
    if (!isBrowserEntry(filename)) continue;
    const visited = new Set();
    const visit = (file) => {
      if (visited.has(file)) return;
      visited.add(file);
      if (
        /\.server\.[tj]sx?$/u.test(file) ||
        /packages\/(?:db|auth)\//u.test(file)
      ) {
        violations.push(
          `${path.relative(root, filename)}: browser imports server code ${path.relative(root, file)}`,
        );
        return;
      }
      for (const specifier of serverDependencies.get(file) ?? [])
        violations.push(
          `${path.relative(root, filename)}: browser imports server dependency ${specifier} through ${path.relative(root, file)}`,
        );
      for (const dependency of graph.get(file) ?? []) visit(dependency);
    };
    visit(filename);
  }
  return { violations, cycles: findCycles(graph) };
}
