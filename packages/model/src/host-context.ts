import type { ProjectIdentificationResult } from "@holon/contracts";

const jsonBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;

/** Supplementary metadata is projected independently of code-review coverage. */
export function compactProjectContext(
  input: ProjectIdentificationResult | undefined,
): string {
  if (!input) return "null";
  const projects = input.projects.map((project) => ({
    root: project.root,
    ecosystem: project.ecosystem,
    status: project.status,
    technologies: [] as Array<{
      name: string;
      category: string;
      declarations: Array<{ value: string; kind: string; condition?: string }>;
    }>,
  }));
  const result = {
    status: input.status,
    limitations: input.limitations.slice(0, 10),
    projects,
    configuredCompatibility: [] as NonNullable<
      ProjectIdentificationResult["configuredCompatibility"]
    >,
    omittedCompatibility: input.configuredCompatibility?.length ?? 0,
    omittedTechnologies: input.projects.reduce(
      (n, p) => n + p.technologies.length,
      0,
    ),
    omittedDeclarations: 0,
    omittedProjects: 0,
  };
  while (jsonBytes(result) > 12000 && projects.length) {
    projects.pop();
    result.omittedProjects++;
  }
  while (jsonBytes(result) > 12000 && result.limitations.length)
    result.limitations.pop();
  // Preserve host comparisons from the compiled configuration as complete entries.
  for (const comparison of input.configuredCompatibility ?? []) {
    if (
      !projects.some(
        (project) =>
          comparison.root === "." ||
          project.root === comparison.root ||
          project.root.startsWith(comparison.root + "/"),
      )
    )
      continue;
    result.configuredCompatibility.push(comparison);
    result.omittedCompatibility--;
    if (jsonBytes(result) > 6000) {
      result.configuredCompatibility.pop();
      result.omittedCompatibility++;
    }
  }
  // Round-robin selection gives each affected project context before filling any one project.
  for (let index = 0; index < 100; index++) {
    for (const [projectIndex, project] of input.projects.entries()) {
      const technology = project.technologies[index];
      if (!technology || !projects[projectIndex]) continue;
      const projected = {
        name: technology.name,
        category: technology.category,
        declarations: technology.declarations.slice(0, 4).map((d) => ({
          value: d.value,
          kind: d.kind,
          ...(d.condition ? { condition: d.condition } : {}),
        })),
      };
      const destination = projects[projectIndex].technologies;
      destination.push(projected);
      result.omittedTechnologies--;
      const omitted = Math.max(0, technology.declarations.length - 4);
      result.omittedDeclarations += omitted;
      if (jsonBytes(result) > 12000) {
        destination.pop();
        result.omittedTechnologies++;
        result.omittedDeclarations -= omitted;
      }
    }
  }
  return JSON.stringify(result);
}
