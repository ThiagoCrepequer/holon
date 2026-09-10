import { readFile, readdir } from "node:fs/promises";

import { repositoryConfigInputSchema } from "@holon/contracts";
import { parseRepositoryConfigurationYaml } from "@holon/repository-config";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { getLanguageService } from "yaml-language-server/lib/umd/languageservice/yamlLanguageService.js";

const schemaText = await readFile(
  new URL("../../../docs/contracts/holon.schema.json", import.meta.url),
  "utf8",
);
const schema: object = JSON.parse(schemaText);
const ajv = new Ajv({ strict: false, allErrors: true });
const validate = ajv.compile(schema);

describe("published editor schema", () => {
  it("validates against draft-07 and accepts every documented example", async () => {
    expect(ajv.validateSchema(schema)).toBe(true);
    const directory = new URL(
      "../../../docs/contracts/examples/",
      import.meta.url,
    );
    for (const name of await readdir(directory)) {
      const input = parseRepositoryConfigurationYaml(
        await readFile(new URL(name, directory), "utf8"),
      );
      expect(validate(input), name).toBe(true);
      expect(repositoryConfigInputSchema.safeParse(input).success, name).toBe(
        true,
      );
    }
  });
  it.each([
    [{}, true],
    [{ instructions: ["guidance", { path: "docs/guidance.md" }] }, true],
    [{ instructions: [{ path: "a.md", text: "mixed" }] }, false],
    [{ output: { language: "fr" } }, false],
    [{ output: { max_inline_comments: 41 } }, false],
    [{ output: { max_inline_comments: 0 } }, true],
    [
      {
        projects: [
          { name: "api", root: ".", compatibility: { runtimes: { java: 21 } } },
        ],
      },
      false,
    ],
    [
      {
        projects: [
          {
            name: "api",
            root: ".",
            compatibility: { runtimes: { java: "21" } },
          },
        ],
      },
      true,
    ],
    [{ review: { typo: true } }, false],
    [{ version: 1 }, false],
    [{ instructions: null }, false],
    [{ instructions: [{ path: "../secret.md" }] }, false],
  ])("matches Zod structural validation for case %#", (input, accepted) => {
    expect(validate(input)).toBe(accepted);
    expect(repositoryConfigInputSchema.safeParse(input).success).toBe(accepted);
  });
  it("supplies completion, hover and precise diagnostics through the YAML Language Server", async () => {
    const uri = "https://holon.example/schemas/holon.schema.json";
    const service = getLanguageService({
      schemaRequestService: async (requested) => {
        expect(requested).toBe(uri);
        return schemaText;
      },
      workspaceContext: { resolveRelativePath: (path) => path },
    });
    service.configure({
      validate: true,
      hover: true,
      completion: true,
      schemas: [{ uri, fileMatch: ["*.yml"], schema }],
    });
    const completionDocument = TextDocument.create(
      "file:///repo/.holon.yml",
      "yaml",
      1,
      "output:\n  ",
    );
    const completions = await service.doComplete(
      completionDocument,
      { line: 1, character: 2 },
      false,
    );
    expect(completions.items.map((item) => item.label)).toEqual(
      expect.arrayContaining(["language", "detail", "max_inline_comments"]),
    );
    const document = TextDocument.create(
      "file:///repo/.holon.yml",
      "yaml",
      2,
      "output:\n  language: pt-BR\n  max_inline_comments: 41\n",
    );
    const hover = await service.doHover(document, { line: 1, character: 5 });
    expect(JSON.stringify(hover)).toContain("Language");
    const diagnostics = await service.doValidation(document, false);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.range.start.line).toBe(2);
    expect(diagnostics[0]?.message).toContain("40");
  });
});
