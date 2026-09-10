import { describe, expect, it } from "vitest";

import { repositoryConfigInputSchema } from "../src/repository-config/input.js";

const config = {
  output: { language: "pt-BR", detail: "concise", max_inline_comments: 8 },
  review: {
    focus: ["correctness", "security"],
    reference_files: ["docs/architecture.md"],
  },
  instructions: [
    "Preserve invariants.\nExplain verified impact.",
    { path: "docs/review.md" },
  ],
  projects: [
    {
      name: "backend",
      root: "apps/backend",
      compatibility: {
        runtimes: { java: "21" },
        frameworks: { quarkus: "3.27.x" },
      },
      instructions: [{ path: "AGENTS.md" }],
    },
  ],
  path_rules: [
    {
      paths: ["apps/backend/db/**"],
      instructions: ["Check transaction boundaries."],
    },
  ],
};

describe("repository configuration input", () => {
  it("preserves multiline text and file instructions without injecting defaults into input", () => {
    expect(repositoryConfigInputSchema.parse(config)).toEqual(config);
    expect(repositoryConfigInputSchema.parse({})).toEqual({});
  });

  it.each([
    { ...config, output: { language: "xx" } },
    { ...config, output: { max_inline_comments: 41 } },
    { ...config, output: { max_inline_comments: -1 } },
    { ...config, output: { max_inline_comments: "8" } },
    { ...config, instructions: [{ path: "AGENTS.md", text: "ambiguous" }] },
    { ...config, instructions: ["   "] },
    { ...config, instructions: [{ path: "../private.md" }] },
    {
      ...config,
      instructions: [{ path: "https://example.com/instructions.md" }],
    },
    { ...config, projects: [{ name: "backend", root: "/etc" }] },
    {
      ...config,
      projects: [
        {
          name: "backend",
          root: ".",
          compatibility: { runtimes: { java: 21 } },
        },
      ],
    },
    { ...config, review: { focus: ["disable_security"] } },
    { ...config, version: 1 },
    { ...config, schemaVersion: 1 },
    { ...config, extra: true },
  ])("rejects unsupported values and unsafe or ambiguous shapes", (invalid) => {
    expect(repositoryConfigInputSchema.safeParse(invalid).success).toBe(false);
  });

  it("accepts zero inline comments and supported global defaults explicitly", () => {
    expect(
      repositoryConfigInputSchema.parse({
        output: { language: "en", detail: "detailed", max_inline_comments: 0 },
      }),
    ).toEqual({
      output: { language: "en", detail: "detailed", max_inline_comments: 0 },
    });
  });
});
