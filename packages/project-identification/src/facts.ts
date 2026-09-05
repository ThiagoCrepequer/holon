import type { IdentificationFact } from "@holon/contracts";

import { list, record, string } from "./sources.js";
export interface ParsedSource {
  path: string;
  digest: string;
  data: Record<string, unknown>;
  content: string;
}
const frameworks = new Set([
  "react",
  "next",
  "tailwindcss",
  "django",
  "flask",
  "fastapi",
  "org.springframework.boot:spring-boot-starter-parent",
  "org.springframework.boot:spring-boot-dependencies",
  "org.springframework:spring-core",
  "io.quarkus.platform:quarkus-bom",
]);
export function category(name: string): IdentificationFact["category"] {
  return frameworks.has(name)
    ? "framework"
    : name === "typescript"
      ? "compiler"
      : ["node", "python", "java"].includes(name)
        ? "runtime"
        : name === "ecmascript"
          ? "language"
          : ["pnpm", "npm", "yarn"].includes(name)
            ? "package-manager"
            : "library";
}
export function versionKind(value: string): IdentificationFact["kind"] {
  return /^\d+(?:\.\d+)*(?:[-+][A-Za-z0-9.-]+)?$/u.test(value)
    ? "declared-exact"
    : /^(?:[~^<>=*]|\d.*[x*|]|\d.* - )/u.test(value)
      ? "declared-range"
      : "unknown";
}
export function extractFacts(
  source: ParsedSource,
  ecosystem: string,
  properties: Record<string, string> = {},
): IdentificationFact[] {
  const facts: IdentificationFact[] = [];
  const add = (
    name: string,
    value: unknown,
    selector: string,
    kind?: IdentificationFact["kind"],
    condition: string | null = null,
  ) => {
    const text = string(value);
    if (
      !text ||
      text.length > 256 ||
      name.length > 256 ||
      selector.length > 256 ||
      Array.from(name).some(
        (c) => c.charCodeAt(0) < 32 || c === "<" || c === ">",
      ) ||
      /https?:|git\+|file:|token|password/iu.test(text)
    )
      return;
    facts.push({
      id: `f${facts.length}:${source.path}`,
      path: source.path,
      digest: source.digest,
      selector,
      name,
      value: text,
      kind: kind ?? versionKind(text),
      category: category(name),
      condition,
    });
  };
  const data = source.data;
  if (source.path.endsWith(".tool-versions"))
    for (const [i, line] of source.content.split("\n").entries()) {
      const match = line.match(
        /^(nodejs|python|java)\s+([\w.+-]+)\s*(?:#.*)?$/u,
      );
      if (match?.[1])
        add(
          match[1] === "nodejs" ? "node" : match[1],
          match[2],
          `line:${i + 1}`,
          "configured-runtime",
        );
    }
  if (ecosystem === "maven" && source.path.endsWith("toolchains.xml"))
    for (const [i, entry] of list(
      record(data.toolchains).toolchain,
    ).entries()) {
      const toolchain = record(entry);
      if (toolchain.type === "jdk")
        add(
          "java",
          record(toolchain.provides).version,
          `toolchains.${i}.provides.version`,
          "configured-runtime",
        );
    }
  if (ecosystem === "node") {
    if (source.path.endsWith("package.json")) {
      for (const section of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
      ])
        for (const [name, value] of Object.entries(record(data[section])))
          add(
            name,
            value,
            `${section}.${name}`,
            section === "peerDependencies" ||
              /^\d+(?:\.\d+)?$/u.test(string(value) ?? "")
              ? "declared-range"
              : undefined,
          );
      add(
        "node",
        record(data.engines).node,
        "engines.node",
        "configured-runtime",
      );
      add("node", record(data.volta).node, "volta.node", "configured-runtime");
      const runtime = record(record(data.devEngines).runtime);
      if (runtime.name === "node")
        add(
          "node",
          runtime.version,
          "devEngines.runtime.version",
          "configured-runtime",
        );
      const pm = string(data.packageManager)?.match(
        /^(npm|pnpm|yarn)@([^+]+)(?:\+.*)?$/u,
      );
      if (pm?.[1]) add(pm[1], pm[2], "packageManager");
    }
    if (source.path.includes("tsconfig"))
      add(
        "ecmascript",
        record(data.compilerOptions).target,
        "compilerOptions.target",
        "configured-target",
      );
    if (/\/(?:\.node-version|\.nvmrc)$/u.test("/" + source.path))
      add("node", source.content.trim(), "runtime-file", "configured-runtime");
  }
  if (ecosystem === "maven" && source.path.endsWith("pom.xml")) {
    const pom = record(data.project);
    const resolve = (value: unknown): string | undefined => {
      let text = string(value);
      const seen = new Set<string>();
      while (text && /^\$\{[^}]+\}$/u.test(text)) {
        if (seen.has(text)) return undefined;
        seen.add(text);
        text = properties[text.slice(2, -1)];
      }
      return text;
    };
    const dep = (
      value: unknown,
      selector: string,
      condition: string | null = null,
    ) => {
      const d = record(value);
      const group = resolve(d.groupId),
        artifact = string(d.artifactId);
      if (!group || !artifact) return;
      const resolved = resolve(d.version);
      add(
        `${group}:${artifact}`,
        resolved ?? string(d.version) ?? "unknown",
        selector + ".version",
        condition ? "conditional" : resolved ? undefined : "unknown",
        condition,
      );
    };
    if (record(pom.parent).artifactId) dep(pom.parent, "project.parent");
    for (const [i, d] of list(record(pom.dependencies).dependency).entries())
      dep(d, `project.dependencies.${i}`);
    for (const [i, d] of list(
      record(record(pom.dependencyManagement).dependencies).dependency,
    ).entries())
      dep(d, `project.dependencyManagement.${i}`);
    for (const key of [
      "maven.compiler.release",
      "maven.compiler.source",
      "maven.compiler.target",
      "java.version",
    ])
      add(
        "java",
        resolve(record(pom.properties)[key]),
        `project.properties.${key}`,
        "configured-target",
      );
    for (const [i, p] of list(
      record(record(pom.build).plugins).plugin,
    ).entries()) {
      const plugin = record(p),
        config = record(plugin.configuration);
      if (plugin.artifactId === "maven-compiler-plugin")
        for (const key of ["release", "source", "target"])
          add(
            "java",
            resolve(config[key]),
            `project.build.plugins.${i}.configuration.${key}`,
            "configured-target",
          );
      if (plugin.artifactId === "maven-toolchains-plugin")
        add(
          "java",
          record(record(config.toolchains).jdk).version,
          `project.build.plugins.${i}.configuration.toolchains.jdk.version`,
          "configured-runtime",
        );
    }
    for (const [i, p] of list(record(pom.profiles).profile).entries()) {
      const profile = record(p);
      for (const [j, d] of list(
        record(profile.dependencies).dependency,
      ).entries())
        dep(
          d,
          `project.profiles.${i}.dependencies.${j}`,
          `profile:${string(profile.id) ?? i}`,
        );
    }
  }
  if (ecosystem === "python") {
    if (source.path.endsWith("pyproject.toml")) {
      const project = record(data.project);
      add(
        "python",
        project["requires-python"],
        "project.requires-python",
        "configured-runtime",
      );
      for (const [i, value] of list(project.dependencies).entries()) {
        const match = string(value)?.match(
          /^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?\s*([^;]*)(?:;(.+))?$/u,
        );
        if (match?.[1])
          add(
            match[1].toLowerCase(),
            match[2]?.trim() || "unknown",
            `project.dependencies.${i}`,
            match[3] ? "conditional" : undefined,
            match[3]?.trim() ?? null,
          );
      }
      const poetry = record(record(data.tool).poetry);
      for (const [name, value] of Object.entries(record(poetry.dependencies)))
        add(
          name,
          typeof value === "object" ? record(value).version : value,
          `tool.poetry.dependencies.${name}`,
          name === "python" ? "configured-runtime" : undefined,
        );
    }
    if (/(?:uv|poetry)\.lock$/u.test(source.path))
      for (const [i, p] of list(data.package).entries()) {
        const pkg = record(p);
        const name = string(pkg.name);
        if (name)
          add(
            name,
            pkg.version,
            `package.${i}.version`,
            "conditional",
            "locked; environment selection not verified",
          );
      }
    if (source.path.endsWith(".python-version"))
      add(
        "python",
        source.content.trim(),
        "runtime-file",
        "configured-runtime",
      );
    if (/(?:requirements|constraints)\.txt$/u.test(source.path))
      for (const [i, line] of source.content.split("\n").entries()) {
        const match = line
          .trim()
          .match(
            /^([A-Za-z0-9_.-]+)\s*(==|>=|<=|~=|>|<)([\w.*+-]+)(?:\s*;(.+))?$/u,
          );
        if (match?.[1])
          add(
            match[1].toLowerCase(),
            match[2] === "==" ? match[3] : `${match[2]}${match[3]}`,
            `line:${i + 1}`,
            match[4] ? "conditional" : undefined,
            match[4] ?? null,
          );
      }
  }
  if (ecosystem === "gradle") {
    if (source.path.endsWith("libs.versions.toml"))
      for (const [alias, v] of Object.entries(record(data.libraries))) {
        const lib = record(v);
        const name =
          string(lib.module) ??
          `${string(lib.group) ?? "unknown"}:${string(lib.name) ?? "unknown"}`;
        const version = lib.version;
        add(
          name,
          typeof version === "object"
            ? record(data.versions)[String(record(version).ref)]
            : version,
          `libraries.${alias}`,
          "conditional",
          "catalog declaration; usage not verified",
        );
      }
    if (source.path.endsWith("gradle.lockfile"))
      for (const [i, line] of source.content.split("\n").entries()) {
        const m = line.match(/^([\w.-]+:[\w.-]+):([^=]+)=(.+)$/u);
        if (m?.[1])
          add(
            m[1],
            m[2],
            `line:${i + 1}`,
            "conditional",
            `configurations:${m[3]}`,
          );
      }
    // Only quoted dependency literals; never evaluate the build language.
    if (/\.gradle(?:\.kts)?$/u.test(source.path))
      for (const [i, line] of source.content.split("\n").entries()) {
        const m = line.match(
          /^\s*(?:implementation|api|compileOnly|runtimeOnly|testImplementation)\s*\(?["']([\w.-]+:[\w.-]+):([\w.+-]+)["']/u,
        );
        if (m?.[1])
          add(
            m[1],
            m[2],
            `line:${i + 1}`,
            "conditional",
            "build script not evaluated",
          );
        const java = line.match(/JavaLanguageVersion\.of\((\d+)\)/u);
        if (java)
          add(
            "java",
            java[1],
            `line:${i + 1}`,
            "conditional",
            "toolchain declaration; build script not evaluated",
          );
      }
  }
  return facts;
}
