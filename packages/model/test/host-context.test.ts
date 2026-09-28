import { expect, it } from "vitest";

import {
  compactProjectContext,
  canonicalEvidenceCandidates,
  selectFinalizationEvidence,
} from "../src/host-context.js";

it("retains all sparse evidence windows admitted by the larger shard", () => {
  const candidates = canonicalEvidenceCandidates([
    {
      path: "src/a.ts",
      mode: "structural",
      patch: `@@ -1,48 +1,96 @@\n${Array.from({ length: 48 }, (_, i) => ` context\n+value${i}`).join("\n")}\n`,
    },
  ]);
  expect(candidates).toHaveLength(48);
  expect(
    selectFinalizationEvidence(candidates, "Investigated the whole file"),
  ).toHaveLength(48);
});

it("bounds finalization evidence by serialized UTF-8 bytes and prioritizes cited locations", () => {
  const candidates = Array.from({ length: 100 }, (_, i) => ({
    path: `src/file${i}.ts`,
    startLine: i + 1,
    endLine: i + 1,
    excerpt: "語".repeat(1100),
  }));
  const selected = selectFinalizationEvidence(
    candidates,
    "src/file99.ts line 100",
  );
  expect(selected[0]).toEqual(candidates[99]);
  expect(
    selected.reduce(
      (sum, item) =>
        sum + new TextEncoder().encode(JSON.stringify(item)).length,
      0,
    ),
  ).toBeLessThanOrEqual(48_000);
  expect(selected.length).toBeLessThan(candidates.length);
});
it("retains configured compatibility conflicts alongside observed versions", () => {
  const result = JSON.parse(
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
              declarations: [{ kind: "locked", value: "20.0.0" }],
            },
          ],
        },
      ],
      configuredCompatibility: [
        {
          name: "api",
          root: "apps/api",
          projectIds: ["api"],
          declarations: [
            {
              category: "runtimes",
              name: "node",
              expected: "22",
              status: "conflicts",
              detected: [
                {
                  projectId: "api",
                  technology: "node",
                  kind: "locked",
                  value: "20.0.0",
                },
              ],
            },
          ],
        },
      ],
    } as never),
  );
  expect(result.configuredCompatibility[0].declarations[0]).toMatchObject({
    name: "node",
    expected: "22",
    status: "conflicts",
  });
  expect(result.projects[0].technologies[0].declarations[0].value).toBe(
    "20.0.0",
  );
});
it("retains complete JSON entities under the version context budget", () => {
  const result = compactProjectContext({
    projects: Array.from({ length: 20 }, (_, i) => ({
      root: `apps/p${i}`,
      ecosystem: "node",
      status: "complete",
      technologies: Array.from({ length: 100 }, (_technology, j) => ({
        name: `lib${j}`,
        category: "library",
        declarations: [
          { value: "1.2.3", kind: "resolved", evidenceIds: ["fact-1"] },
        ],
      })),
    })),
    limitations: [],
    status: "complete",
  } as never);
  expect(() => JSON.parse(result)).not.toThrow();
  expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(12000);
  expect(JSON.parse(result).omittedTechnologies).toBeGreaterThan(0);
});
it("provides literal canonical evidence even when the investigation only describes the bug", () => {
  const candidates = canonicalEvidenceCandidates([
    {
      path: "a.ts",
      mode: "structural",
      patch: "@@ -10 +10 @@\n-if (allowed) write();\n+write();",
    },
  ]);
  const selected = selectFinalizationEvidence(
    candidates,
    "a.ts has an unconditional write that bypasses authorization.",
  );
  expect(selected).toContainEqual(
    expect.objectContaining({
      path: "a.ts",
      startLine: 10,
      excerpt: "write();",
    }),
  );
});
