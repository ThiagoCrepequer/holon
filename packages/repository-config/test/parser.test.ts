import { describe, expect, it } from "vitest";

import { parseRepositoryConfigurationYaml } from "../src/index.js";
describe("configuration YAML security boundary", () => {
  it("preserves multiline guidance and quoted versions", () => {
    expect(
      parseRepositoryConfigurationYaml(
        'instructions:\n  - |\n    First line\n    Second line\nprojects:\n  - name: api\n    root: .\n    compatibility:\n      runtimes:\n        java: "21"\n',
      ),
    ).toMatchObject({
      instructions: ["First line\nSecond line\n"],
      projects: [{ compatibility: { runtimes: { java: "21" } } }],
    });
  });
  it.each([
    "a: &anchor hello\nb: *anchor",
    "a: !!str hello",
    "a: 1\na: 2",
    "a: 1\n---\nb: 2",
    "%YAML 1.1\n---\na: yes",
    "<<: {}",
    "__proto__: {}",
    "- item",
    "null",
    "a: [1, 2",
    `a: ${"[".repeat(20)}0${"]".repeat(20)}`,
  ])("rejects unsafe YAML without echoing content (%#)", (raw) => {
    expect(() => parseRepositoryConfigurationYaml(raw)).toThrow(
      /^Repository configuration: invalid_yaml/u,
    );
  });
  it("rejects the byte budget before parsing", () => {
    expect(() => parseRepositoryConfigurationYaml("#".repeat(65537))).toThrow(
      /budget_exceeded/u,
    );
  });
});
