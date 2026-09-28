import { expect, it } from "vitest";

import {
  compactProjectContext,
  createFinalizationEvidenceCatalog,
  canonicalEvidenceCandidates,
  selectFinalizationEvidence,
} from "../src/host-context.js";
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

it("binds evidence IDs to content, path and coordinates while preserving literal bytes", async () => {
  const entry = {
    path: "a.ts",
    startLine: 10,
    endLine: 10,
    excerpt: "  return a <= b;",
  };
  const first = await createFinalizationEvidenceCatalog([entry], "a.ts");
  const second = await createFinalizationEvidenceCatalog(
    [entry],
    "Different investigation text",
  );
  expect(first).toEqual(second);
  expect(first[0]?.excerpt).toBe(entry.excerpt);
  for (const changed of [
    { ...entry, excerpt: "return a < b;" },
    { ...entry, path: "b.ts" },
    { ...entry, startLine: 11, endLine: 11 },
  ]) {
    expect(
      (await createFinalizationEvidenceCatalog([changed], ""))[0]?.id,
    ).not.toBe(first[0]?.id);
  }
  expect(
    await createFinalizationEvidenceCatalog([entry, entry], ""),
  ).toHaveLength(1);
});

it("never turns redacted source into canonical evidence", () => {
  const entries = canonicalEvidenceCandidates([
    {
      mode: "textual",
      path: "a.ts",
      patch:
        '@@ -0,0 +1,2 @@\n+const token = "ghp_123456789012345678901234567890123456";\n+return true;',
    },
  ]);
  expect(entries).toEqual([
    { path: "a.ts", startLine: 2, endLine: 2, excerpt: "return true;" },
  ]);
});

it("keeps IDs inside the serialized catalog budget and prioritizes a cited interior line", async () => {
  const entries = Array.from({ length: 100 }, (_, index) => ({
    path: "a.ts",
    startLine: index * 8 + 1,
    endLine: index * 8 + 8,
    excerpt: "x".repeat(1_000),
  }));
  const catalog = await createFinalizationEvidenceCatalog(
    entries,
    "a.ts line 799",
  );
  expect(catalog[0]?.startLine).toBe(793);
  expect(catalog.length).toBeLessThan(entries.length);
  expect(
    new TextEncoder().encode(JSON.stringify(catalog)).length,
  ).toBeLessThanOrEqual(24_000);
});
