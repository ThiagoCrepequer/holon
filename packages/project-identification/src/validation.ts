import {
  projectIdentificationModelOutputSchema,
  type IdentifiedProject,
} from "@holon/contracts";
export function verifyInterpretation(
  project: IdentifiedProject,
  raw: unknown,
): IdentifiedProject {
  const output = projectIdentificationModelOutputSchema.parse(raw);
  const ids = new Set(project.facts.map((f) => f.id));
  if (
    new Set(output.selectedFactIds).size !== output.selectedFactIds.length ||
    output.selectedFactIds.some((id) => !ids.has(id))
  )
    throw new Error("invalid-identification-evidence");
  const technologies = project.technologies.map((technology) => ({
    ...technology,
  }));
  for (const classification of output.classifications ?? []) {
    const technology = technologies.find((t) => t.name === classification.name);
    if (
      !technology ||
      classification.evidenceIds.some(
        (id) =>
          !project.facts.some(
            (f) => f.id === id && f.name === classification.name,
          ),
      )
    )
      throw new Error("invalid-technology-classification");
    if (
      technology.category === "library" &&
      ["library", "framework"].includes(classification.category)
    ) {
      technology.category = classification.category;
      technology.classificationSource = "model";
    }
  }
  // The model annotates verified evidence, it cannot erase deterministic declarations.
  return { ...project, technologies, interpretation: "model-verified" };
}
