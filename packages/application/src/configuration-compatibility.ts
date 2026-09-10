import type {
  IdentifiedProject,
  ProjectIdentificationResult,
  RunConfigurationSnapshot,
} from "@holon/contracts";
import { selectConfiguredProject } from "@holon/domain";
import {
  valid as validPythonVersion,
  validRange as validPythonRange,
  satisfies as satisfiesPython,
} from "@renovatebot/pep440";
import { intersects, subset, validRange } from "semver";

import { RepositoryConfigurationError } from "./repository-configuration-error.js";

type Comparison = "matches" | "conflicts" | "unknown";
const npmNames = new Set([
  "node",
  "react",
  "next",
  "tailwindcss",
  "typescript",
  "vue",
  "angular",
  "svelte",
]);
const javaNames = new Set(["java", "quarkus", "spring-boot", "spring"]);
const pythonNames = new Set(["python", "django", "flask", "fastapi"]);
const aliases: Record<string, readonly string[]> = {
  quarkus: ["io.quarkus.platform:quarkus-bom"],
  "spring-boot": [
    "org.springframework.boot:spring-boot-starter-parent",
    "org.springframework.boot:spring-boot-dependencies",
  ],
  spring: ["org.springframework:spring-core"],
  angular: ["@angular/core"],
};
const numericFamily = /^\d+(?:\.\d+){0,2}(?:\.[x*])?$/u;
function pythonRange(value: string): string {
  if (/^\d+(?:\.\d+)?$/u.test(value)) return `==${value}.*`;
  return validPythonVersion(value) ? `==${value}` : value;
}
/** Known grammars are validated separately from the intentionally conservative comparison subset. */
export function validateCompatibilityDeclaration(
  name: string,
  value: string,
  location: string,
): void {
  const valid = npmNames.has(name)
    ? validRange(value) !== null
    : pythonNames.has(name)
      ? validPythonRange(pythonRange(value))
      : javaNames.has(name)
        ? numericFamily.test(value) ||
          /^(?:\[[^,[\]()]+\]|[[(][^,[\]()]*,[^,[\]()]*[)\]])(?:,\s*[[(][^,[\]()]*,[^,[\]()]*[)\]])*$/u.test(
            value,
          ) ||
          /^\d+(?:\.[A-Za-z0-9_-]+)+$/u.test(value)
        : true;
  if (!valid)
    throw new RepositoryConfigurationError("invalid_compatibility", location);
}
/** Only compare numeric Java families without interpreting Maven qualifiers as SemVer. */
function range(name: string, value: string): string | null {
  if (npmNames.has(name)) return validRange(value);
  if (javaNames.has(name))
    return numericFamily.test(value) ? validRange(value) : null;
  return null;
}
export function compareCompatibilityValue(
  name: string,
  expected: string,
  detected: string,
  kind: string,
): Comparison {
  if (kind === "conditional" || kind === "unknown") return "unknown";
  if (pythonNames.has(name)) {
    if (
      kind === "declared-range" ||
      !validPythonVersion(detected) ||
      !validPythonRange(pythonRange(expected))
    )
      return "unknown";
    if (kind === "configured-runtime" && /^\d+(?:\.\d+)?$/u.test(detected))
      return "unknown";
    return satisfiesPython(detected, pythonRange(expected))
      ? "matches"
      : "conflicts";
  }
  const requested = range(name, expected),
    actual = range(name, detected);
  if (requested === null || actual === null) return "unknown";
  if (subset(actual, requested)) return "matches";
  return intersects(actual, requested) ? "unknown" : "conflicts";
}
export function projectCompatibility(
  snapshot: RunConfigurationSnapshot,
  identification: ProjectIdentificationResult,
): NonNullable<ProjectIdentificationResult["configuredCompatibility"]> {
  return snapshot.config.projects.map((configured) => {
    const projects = identification.projects.filter(
      (project) =>
        selectConfiguredProject(project.root, snapshot.config.projects)
          ?.name === configured.name,
    );
    const declarations = (["runtimes", "frameworks"] as const).flatMap(
      (category) =>
        Object.entries(configured.compatibility[category] ?? {}).map(
          ([name, expected]) => {
            const detected = projects.flatMap((project) =>
              project.technologies
                .filter(
                  (technology) =>
                    technology.name === name ||
                    aliases[name]?.includes(technology.name),
                )
                .flatMap((technology) =>
                  technology.declarations.map((declaration) => ({
                    projectId: project.id,
                    technology: technology.name,
                    ...declaration,
                  })),
                ),
            );
            const outcomes = detected.map((fact) =>
              compareCompatibilityValue(name, expected, fact.value, fact.kind),
            );
            const status: Comparison | "not_detected" =
              detected.length === 0
                ? identification.status === "complete" &&
                  (npmNames.has(name) ||
                    javaNames.has(name) ||
                    pythonNames.has(name))
                  ? "not_detected"
                  : "unknown"
                : outcomes.includes("conflicts")
                  ? "conflicts"
                  : outcomes.every((value) => value === "matches")
                    ? "matches"
                    : "unknown";
            return { category, name, expected, status, detected };
          },
        ),
    );
    return {
      name: configured.name,
      root: configured.root,
      projectIds: projects.map((project: IdentifiedProject) => project.id),
      declarations,
    };
  });
}
