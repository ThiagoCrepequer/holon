import type { ProjectIdentificationResult } from "@holon/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RepositoryConfiguration } from "../app/components/repository-configuration.js";
import { configuration, identification } from "./configuration-fixtures.js";

describe("repository configuration server rendering", () => {
  it("does not present an unrecorded configuration as proven defaults", () => {
    const html = renderToStaticMarkup(
      <RepositoryConfiguration configuration={null} identification={null} />,
    );
    expect(html).toContain(
      "No compiled configuration was recorded for this run.",
    );
    expect(html).not.toContain("Built-in defaults");
    expect(html).not.toContain("Configuration provenance");
  });

  it("renders proven defaults without configured scopes or exclusions", () => {
    const html = renderToStaticMarkup(
      <RepositoryConfiguration
        configuration={{
          ...configuration,
          source: "default",
          output: { language: "en", detail: "concise", maxInlineComments: 40 },
          verdictStrictness: "default",
          instructionCount: 0,
          referenceCount: 0,
          pathRuleCount: 0,
          additionalExcludes: [],
          projects: [],
          focus: [],
        }}
        identification={null}
      />,
    );
    expect(html).toContain("Built-in defaults (configuration absent)");
    expect(html).toContain("All defect categories");
    expect(html).toMatch(/Review language<\/dt><dd[^>]*>en<\/dd>/u);
    expect(html).toMatch(/Narrative detail<\/dt><dd[^>]*>concise<\/dd>/u);
    expect(html).toMatch(/New inline comment limit<\/dt><dd[^>]*>40<\/dd>/u);
    expect(html).toMatch(/Verdict policy<\/dt><dd[^>]*>default<\/dd>/u);
    expect(html).toContain(
      "0 instructions · 0 referenced files · 0 path rules",
    );
    expect(html).not.toContain("No compiled configuration");
    expect(html).not.toContain("Additional exclusions");
    expect(html).not.toContain("Configured scope");
  });

  it("renders effective preferences and complete base-commit provenance before hydration", () => {
    const html = renderToStaticMarkup(
      <RepositoryConfiguration
        configuration={configuration}
        identification={identification}
      />,
    );
    expect(html).toMatch(/Source<\/dt><dd[^>]*>\.holon.yml<\/dd>/u);
    expect(html).toMatch(/Base commit<\/dt><dd[^>]*>b{40}<\/dd>/u);
    expect(html).toMatch(/Review language<\/dt><dd[^>]*>pt-BR<\/dd>/u);
    expect(html).toMatch(/Narrative detail<\/dt><dd[^>]*>detailed<\/dd>/u);
    expect(html).toMatch(/New inline comment limit<\/dt><dd[^>]*>0<\/dd>/u);
    expect(html).toMatch(
      /Verdict policy<\/dt><dd[^>]*>block_all_confident_medium<\/dd>/u,
    );
    expect(html).toContain("correctness, security");
    expect(html).toContain(
      "3 instructions · 2 referenced files · 1 path rules",
    );
    expect(html).toContain("apply after merging into the base branch");
    expect(html).toContain("Additional exclusions (1)");
    expect(html).toContain("<li>docs/generated/**</li>");
    expect(html).toContain("Configuration provenance");
    expect(html).toMatch(/Effective digest<\/dt><dd>c{64}<\/dd>/u);
    expect(html).toMatch(/Source digest<\/dt><dd>d{64}<\/dd>/u);
    expect(html).toMatch(/Scope digest<\/dt><dd>e{64}<\/dd>/u);
    expect(html).not.toContain("Built-in defaults");
  });

  it("associates each declaration with its own scope, category, status and detected evidence", () => {
    const comparison = identification.configuredCompatibility![0]!;
    const html = renderToStaticMarkup(
      <RepositoryConfiguration
        configuration={configuration}
        identification={{
          ...identification,
          configuredCompatibility: [
            {
              ...comparison,
              name: "another-scope",
              projectIds: ["unrelated-project"],
              declarations: [],
            },
            {
              ...comparison,
              declarations: [
                {
                  category: "runtimes",
                  name: "react",
                  expected: "^19",
                  status: "matches",
                  detected: [],
                },
                ...comparison.declarations,
              ],
            },
          ],
        }}
      />,
    );
    expect(html).toContain('aria-label="Configured scope api"');
    expect(html).toContain("apps/api");
    expect(html).toContain("Detected projects: detected-api");
    const declarations = html.match(/<dt[^>]*>[^]*?<\/dd>/gu) ?? [];
    expect(declarations.find((row) => row.includes(">node "))).toMatch(
      /24[^]*Matches detected evidence[^]*24\.4\.0[^]*declared-exact/u,
    );
    expect(declarations.find((row) => row.includes(">react "))).toMatch(
      /\^19[^]*Conflicts with detected evidence[^]*18\.3\.1[^]*declared-exact · workspace/u,
    );
    expect(declarations.find((row) => row.includes(">unknown "))).toContain(
      "Comparison unavailable",
    );
    expect(declarations.find((row) => row.includes(">missing "))).toContain(
      "Not detected",
    );
    expect(html).toContain("A mismatch alone does not block the review.");
    expect(html).not.toContain("unrelated-project");
    expect(html).not.toContain("Not compared in this run");
  });

  it.each<{ state: string; result: ProjectIdentificationResult | null }>([
    { state: "identification unavailable", result: null },
    {
      state: "comparisons unrecorded",
      result: { ...identification, configuredCompatibility: undefined },
    },
    {
      state: "scope without detected projects or declarations",
      result: {
        ...identification,
        configuredCompatibility: [
          { name: "api", root: "apps/api", projectIds: [], declarations: [] },
        ],
      },
    },
  ])("does not invent comparison results with $state", ({ result }) => {
    const html = renderToStaticMarkup(
      <RepositoryConfiguration
        configuration={configuration}
        identification={result}
      />,
    );
    expect(html.match(/Not compared in this run/gu)).toHaveLength(4);
    expect(html).toContain("No associated detected project");
    expect(html).not.toContain("Matches detected evidence");
    expect(html).not.toContain("Conflicts with detected evidence");
  });

  it("keeps configured scopes that omit one or both compatibility categories", () => {
    const html = renderToStaticMarkup(
      <RepositoryConfiguration
        configuration={{
          ...configuration,
          projects: [
            { name: "docs", root: "docs", compatibility: {} },
            {
              name: "api",
              root: "apps/api",
              compatibility: { runtimes: { node: "24" } },
            },
            {
              name: "web",
              root: "apps/web",
              compatibility: { frameworks: { react: "^19" } },
            },
          ],
        }}
        identification={null}
      />,
    );
    expect(html).toContain('aria-label="Configured scope docs"');
    expect(html).toContain('aria-label="Configured scope api"');
    expect(html).toContain('aria-label="Configured scope web"');
    expect(html.match(/Not compared in this run/gu)).toHaveLength(2);
    expect(html).not.toContain("undefined");
  });

  it("escapes repository-controlled evidence and conditions in the server response", () => {
    const html = renderToStaticMarkup(
      <RepositoryConfiguration
        configuration={configuration}
        identification={{
          ...identification,
          configuredCompatibility: [
            {
              name: "api",
              root: "apps/api",
              projectIds: ["detected-api"],
              declarations: [
                {
                  category: "runtimes",
                  name: "node",
                  expected: "24",
                  status: "unknown",
                  detected: [
                    {
                      projectId: "detected-api",
                      technology: "node",
                      kind: "conditional",
                      evidenceIds: ["fact-node"],
                      value: "<script>alert(1)</script>",
                      condition: "runtime < 24 && preview",
                    },
                  ],
                },
              ],
            },
          ],
        }}
      />,
    );
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("runtime &lt; 24 &amp;&amp; preview");
    expect(html).not.toContain("<script>");
  });
});
