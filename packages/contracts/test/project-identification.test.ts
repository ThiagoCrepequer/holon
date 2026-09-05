import { it, expect } from "vitest";

import { identifiedProjectSchema } from "../src/project-identification.js";
const fact = {
  id: "f",
  path: "package.json",
  digest: "a".repeat(64),
  selector: "dependencies.react",
  name: "react",
  value: "19.0.0",
  kind: "declared-exact",
  category: "framework",
  condition: null,
};
const project = {
  id: "node:.",
  root: ".",
  ecosystem: "node",
  fingerprint: "b".repeat(64),
  status: "complete",
  facts: [fact],
  technologies: [
    {
      name: "react",
      category: "framework",
      declarations: [
        {
          value: "19.0.0",
          kind: "declared-exact",
          evidenceIds: ["f"],
          condition: null,
        },
      ],
    },
  ],
  sourcePaths: ["package.json"],
  limitations: [],
  interpretation: "deterministic",
};
it("rejects invented versions, missing evidence, and evidence outside collected sources", () => {
  expect(identifiedProjectSchema.safeParse(project).success).toBe(true);
  for (const changed of [
    { ...project, facts: [fact, fact] },
    { ...project, sourcePaths: [] },
    { ...project, facts: [{ ...fact, value: "18.0.0" }] },
    { ...project, facts: [{ ...fact, id: "another" }] },
  ])
    expect(identifiedProjectSchema.safeParse(changed).success).toBe(false);
});
