import { describe, it, expect } from "vitest";

import { parseSource, localPath, isMetadataPath } from "../src/sources.js";
describe("bounded configuration parsers", () => {
  it.each([
    ["package.json", '{"x":1,"x":2}'],
    ["package.json", "{"],
    ["package.json", '{"x":1,}'],
    ["pom.xml", "<!DOCTYPE p><p/>"],
    ["pom.xml", "<p>"],
    ["x.yaml", "a: &a [*a]"],
    ["x.yaml", "a: 1\na: 2"],
    ["x.yaml", "a: !custom 1"],
    ["x.toml", "x=1\nx=2"],
  ])("rejects ambiguous or unsafe %s %s", (path, text) =>
    expect(() => parseSource(path, text)).toThrow(),
  );
  it.each([
    ["package.json", '{"version":"1"}'],
    ["tsconfig.json", '{/* comment */"target":"ES2022",}'],
    ["x.yaml", "x: 1"],
    ["x.toml", "x=1"],
    ["pom.xml", "<project><version>1</version></project>"],
    ["uv.lock", "version=1"],
    ["poetry.lock", "version=1"],
  ])("reads %s", (p, t) =>
    expect(Object.keys(parseSource(p, t)).length).toBeGreaterThan(0),
  );
  it("does not execute executable configurations", () =>
    expect(parseSource("build.gradle", "throw new Error()")).toEqual({}));
  it.each([
    ["a/b", "../pom.xml", "a/pom.xml"],
    [".", "../secret", undefined],
    ["a", "/etc/passwd", undefined],
    ["a", "x\\y", undefined],
    ["a", "./b", "a/b"],
  ])("normalizes local references %s %s", (r, p, v) =>
    expect(localPath(r, p)).toBe(v),
  );
  it("recognizes supported metadata only", () => {
    expect(isMetadataPath("a/tsconfig.base.json")).toBe(true);
    expect(isMetadataPath(".env")).toBe(false);
  });
});
