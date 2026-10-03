import { expect, it } from "vitest";

import { compactProjectContext } from "../src/host-context.js";

it("represents absent identification without inventing project versions", () => {
  expect(compactProjectContext(undefined)).toBe("null");
});

it("keeps observed versions and complete relevant compatibility declarations", () => {
  const compacted = JSON.parse(
    compactProjectContext({
      status: "complete",
      limitations: [],
      projects: [
        {
          root: "apps/api",
          ecosystem: "node",
          status: "complete",
          technologies: [
            {
              name: "node",
              category: "runtime",
              declarations: [
                { kind: "locked", value: "20.0.0", condition: "production" },
                { kind: "range", value: ">=20" },
              ],
            },
          ],
        },
      ],
      configuredCompatibility: [
        {
          name: "api",
          root: "apps/api",
          declarations: [
            {
              category: "runtimes",
              name: "node",
              expected: "22",
              status: "conflicts",
            },
          ],
        },
        { name: "other", root: "apps/other", declarations: [] },
      ],
    } as never),
  );
  expect(compacted.projects[0].technologies[0].declarations).toEqual([
    { kind: "locked", value: "20.0.0", condition: "production" },
    { kind: "range", value: ">=20" },
  ]);
  expect(compacted.configuredCompatibility).toHaveLength(1);
  expect(compacted.configuredCompatibility[0].declarations[0].status).toBe(
    "conflicts",
  );
  expect(compacted.omittedCompatibility).toBe(1);
});

it("preserves whole JSON entities while bounding many projects and technologies", () => {
  const compacted = compactProjectContext({
    status: "complete",
    limitations: [],
    projects: Array.from({ length: 40 }, (_project, index) => ({
      root: `apps/${index}-${"name".repeat(25)}`,
      ecosystem: "node",
      status: "complete",
      technologies: Array.from({ length: 80 }, (_technology, technology) => ({
        name: `library-${technology}`,
        category: "library",
        declarations: Array.from({ length: 8 }, (_declaration, version) => ({
          value: `${version}.0.0`,
          kind: "resolved",
        })),
      })),
    })),
  } as never);
  const result = JSON.parse(compacted);
  expect(new TextEncoder().encode(compacted).byteLength).toBeLessThanOrEqual(
    12_000,
  );
  expect(
    result.omittedProjects +
      result.omittedTechnologies +
      result.omittedDeclarations,
  ).toBeGreaterThan(0);
  expect(
    result.projects.every(
      (project: { technologies: Array<{ declarations: unknown[] }> }) =>
        project.technologies.every(
          (technology) => technology.declarations.length <= 4,
        ),
    ),
  ).toBe(true);
});

it("drops oversized limitations and comparisons rather than emitting partial values", () => {
  const compacted = JSON.parse(
    compactProjectContext({
      status: "partial",
      limitations: Array.from({ length: 10 }, () => "x".repeat(3_000)),
      projects: [
        {
          root: "apps/api",
          ecosystem: "node",
          status: "partial",
          technologies: [],
        },
      ],
      configuredCompatibility: [
        { name: "x".repeat(7_000), root: "apps/api", declarations: [] },
      ],
    } as never),
  );
  expect(compacted.limitations.length).toBeLessThan(10);
  expect(compacted.configuredCompatibility).toHaveLength(0);
  expect(compacted.omittedCompatibility).toBe(1);
});
