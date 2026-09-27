import { matchesPathGlob } from "./repository-policy.js";

export interface ConfiguredProjectScope {
  readonly name: string;
  readonly root: string;
}
/** Segment-aware, case-sensitive Git paths. An ancestor project's instructions are not inherited. */
export function selectConfiguredProject<T extends ConfiguredProjectScope>(
  path: string,
  projects: readonly T[],
): T | undefined {
  return projects
    .filter(
      (project) =>
        project.root === "." ||
        path === project.root ||
        path.startsWith(`${project.root}/`),
    )
    .toSorted(
      (a, b) =>
        b.root.split("/").length - a.root.split("/").length ||
        b.root.length - a.root.length,
    )[0];
}
export function matchingConfigurationRules<
  T extends { readonly paths: readonly string[] },
>(path: string, rules: readonly T[]): T[] {
  return rules.filter((rule) =>
    rule.paths.some((glob) => matchesPathGlob(path, glob)),
  );
}
