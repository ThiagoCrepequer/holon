import { describe, expect, it } from "vitest";

import { extractChangedSymbols } from "../src/symbol-extractor.js";

const path = "src/producer.ts";
const bodyPatch =
  "@@ -1,3 +1,3 @@\n export const produce = () => {\n-  return 1;\n+  return 2;\n };";
describe("changed head declarations", () => {
  it("retains a canonical edit coordinate when the declaration starts before its diff hunk", () => {
    const content =
      "export function produce() {\n" +
      "  // padding\n".repeat(35) +
      "  return 2;\n}";
    const patch = "@@ -37 +37 @@\n-  return 1;\n+  return 2;";
    expect(
      extractChangedSymbols([{ path, patch }], [{ path, content }]),
    ).toEqual([
      {
        path,
        name: "produce",
        kind: "function",
        isExported: true,
        change: "modified",
        line: 1,
        patchLine: 37,
      },
    ]);
  });
  it("traces every public alias of an edited local declaration", () => {
    const content =
      "const produce = () => {\n  return 2;\n};\nexport { produce as payload, produce as result };\nconst other = 3;\nexport { other as unrelated };";
    const symbols = extractChangedSymbols(
      [{ path, patch: bodyPatch.replace("export const", "const") }],
      [{ path, content }],
    );
    expect(symbols).toEqual([
      {
        path,
        name: "produce",
        line: 1,
        kind: "constant",
        isExported: true,
        change: "modified",
      },
      {
        path,
        name: "payload",
        line: 1,
        kind: "constant",
        isExported: true,
        change: "modified",
      },
      {
        path,
        name: "result",
        line: 1,
        kind: "constant",
        isExported: true,
        change: "modified",
      },
    ]);
  });

  it("retains a local export when a changed signature was extracted lexically", () => {
    const patch =
      "@@ -1,3 +1,3 @@\n-function produce(input: number) {\n+function produce(input: string) {\n   return input;\n }";
    const content =
      "function produce(input: string) {\n  return input;\n}\nexport { produce };";
    expect(
      extractChangedSymbols([{ path, patch }], [{ path, content }]),
    ).toEqual([
      {
        path,
        name: "produce",
        line: 1,
        kind: "function",
        isExported: true,
        change: "modified",
      },
    ]);
  });
  it("traces a locally exported arrow without marking an unchanged sibling", () => {
    const content =
      "const produce = () => {\n  return 2;\n};\nexport { produce };\nexport const untouched = 3;";
    const symbols = extractChangedSymbols(
      [{ path, patch: bodyPatch.replace("export const", "const") }],
      [{ path, content }],
    );
    expect(symbols).toEqual([
      {
        path,
        name: "produce",
        line: 1,
        kind: "constant",
        isExported: true,
        change: "modified",
      },
    ]);
  });
  it("tracks a removed body statement without blaming the next declaration", () => {
    const patch =
      "@@ -1,5 +1,4 @@\n export function produce() {\n-  validate();\n   return 2;\n }\n export function next() {}";
    const content =
      "export function produce() {\n  return 2;\n}\nexport function next() {}";
    expect(
      extractChangedSymbols([{ path, patch }], [{ path, content }]).map(
        (symbol) => symbol.name,
      ),
    ).toEqual(["produce"]);
  });
  it("preserves added status for a newly introduced declaration", () => {
    const patch =
      "@@ -0,0 +1,3 @@\n+export const produce = () => {\n+  return 2;\n+};";
    expect(
      extractChangedSymbols(
        [{ path, patch }],
        [{ path, content: "export const produce = () => {\n  return 2;\n};" }],
      ),
    ).toEqual([
      {
        path,
        name: "produce",
        line: 1,
        kind: "constant",
        isExported: true,
        change: "added",
      },
    ]);
  });
  it("does not invent symbols from an invalid module or unrelated language", () => {
    expect(
      extractChangedSymbols(
        [{ path, patch: bodyPatch }],
        [{ path, content: "export const produce = {" }],
      ),
    ).toEqual([]);
    expect(
      extractChangedSymbols(
        [{ path: "src/producer.py", patch: bodyPatch }],
        [
          {
            path: "src/producer.py",
            content: "export const produce = () => {\n  return 2;\n};",
          },
        ],
      ),
    ).toEqual([]);
  });
  it("identifies a class when an unchanged method signature surrounds the edit", () => {
    const patch =
      "@@ -2,3 +2,3 @@\n   value() {\n-    return 1;\n+    return 2;\n   }";
    expect(
      extractChangedSymbols(
        [{ path, patch }],
        [
          {
            path,
            content:
              "export class Producer {\n  value() {\n    return 2;\n  }\n}",
          },
        ],
      ),
    ).toEqual([
      {
        path,
        name: "Producer",
        line: 1,
        patchLine: 3,
        kind: "class",
        isExported: true,
        change: "modified",
      },
    ]);
  });
});
