import type { ProjectIdentificationResult } from "@holon/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";

import { ProjectVersions } from "../app/components/project-versions.js";
const result: ProjectIdentificationResult = {
  snapshotSha: "a".repeat(40),
  inventoryDigest: "b".repeat(64),
  detectorRevision: "v1",
  status: "partial",
  limitations: ["base unavailable"],
  projects: [
    {
      id: "node:apps/web",
      root: "apps/web",
      ecosystem: "node",
      fingerprint: "c".repeat(64),
      status: "partial",
      interpretation: "deterministic",
      sourcePaths: ["apps/web/package.json"],
      facts: [
        {
          id: "f1",
          name: "react",
          category: "framework",
          value: "^19.0.0",
          kind: "declared-range",
          path: "apps/web/package.json",
          digest: "d".repeat(64),
          selector: "dependencies.react",
          condition: null,
        },
      ],
      technologies: [
        {
          name: "react",
          category: "framework",
          declarations: [
            {
              value: "^19.0.0",
              kind: "declared-range",
              evidenceIds: ["f1"],
              condition: null,
            },
            {
              value: "19.1.0",
              kind: "conditional",
              evidenceIds: ["f1"],
              condition: "production only",
            },
          ],
        },
      ],
      limitations: ["runtime unknown"],
    },
  ],
};
describe("run project versions", () => {
  it("shows project, semantics, evidence, snapshot and limitations", () => {
    const html = renderToStaticMarkup(<ProjectVersions result={result} />);
    for (const text of [
      "apps/web",
      "react",
      "^19.0.0",
      "Version range",
      "Conditional",
      "production only",
      "apps/web/package.json",
      "dependencies.react",
      "Identification limitations",
      "aaaaaaaaaaaa",
      "base unavailable",
    ])
      expect(html).toContain(text);
  });
  it("distinguishes absent identification from an empty identified scope", () => {
    expect(renderToStaticMarkup(<ProjectVersions result={null} />)).toContain(
      "not recorded",
    );
    expect(
      renderToStaticMarkup(
        <ProjectVersions result={{ ...result, projects: [] }} />,
      ),
    ).toContain("No supported projects");
  });
  it("shows a project without declarations without inventing zero versions", () => {
    const p = { ...result.projects[0]!, technologies: [], limitations: [] };
    expect(
      renderToStaticMarkup(
        <ProjectVersions
          result={{
            ...result,
            status: "complete",
            projects: [p],
            limitations: [],
          }}
        />,
      ),
    ).toContain("No version declarations");
  });
});
