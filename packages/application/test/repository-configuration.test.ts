import { describe, expect, it } from "vitest";

import { compileRepositoryConfiguration } from "../src/repository-configuration.js";

const identity = {
  installationId: 1,
  repositoryId: 2,
  pullRequestNumber: 3,
  baseSha: "a".repeat(40),
  headSha: "b".repeat(40),
  runId: `github:2:pr:3:head:${"b".repeat(40)}:base:${"a".repeat(40)}`,
};
const bytes = (text: string) => new TextEncoder().encode(text);
function reader(files: Record<string, string> = {}) {
  return {
    readFile: async (path: string) =>
      path in files
        ? { kind: "found" as const, bytes: bytes(files[path]!) }
        : { kind: "absent" as const },
    directoryExists: async () => true,
    isReferenceAllowed: () => true,
  };
}
const parser = (raw: string): unknown => JSON.parse(raw);
describe("repository configuration compiler", () => {
  it("materializes defaults only after proving both bootstrap paths absent", async () => {
    const result = await compileRepositoryConfiguration(
      identity,
      reader(),
      parser,
    );
    expect(result.config.output).toEqual({
      language: "en",
      detail: "concise",
      maxInlineComments: 40,
    });
    expect(result.config.source).toBe("default");
  });
  it("reads project references relative to the project and global references from repository root", async () => {
    const result = await compileRepositoryConfiguration(
      identity,
      reader({
        ".github/holon.yml": JSON.stringify({
          instructions: [{ path: "guide.md" }],
          projects: [
            {
              name: "api",
              root: "apps/api",
              instructions: [{ path: "guide.md" }],
            },
          ],
        }),
        "guide.md": "global",
        "apps/api/guide.md": "project",
      }),
      parser,
    );
    expect(result.config.instructions[0]?.text).toBe("global");
    expect(result.config.projects[0]?.instructions[0]?.path).toBe(
      "apps/api/guide.md",
    );
  });
  it("rejects conflicting files, unsafe exclusions and duplicate roots", async () => {
    await expect(
      compileRepositoryConfiguration(
        identity,
        reader({ ".holon.yml": "{}", ".github/holon.yml": "{}" }),
        parser,
      ),
    ).rejects.toMatchObject({ code: "conflicting_sources" });
    for (const config of [
      { review: { additional_excludes: ["**/*"] } },
      {
        projects: [
          { name: "a", root: "." },
          { name: "b", root: "." },
        ],
      },
    ]) {
      await expect(
        compileRepositoryConfiguration(
          identity,
          reader({ ".holon.yml": JSON.stringify(config) }),
          parser,
        ),
      ).rejects.toMatchObject({ code: "invalid_configuration" });
    }
  });
  it("keeps scope digest stable across language changes but changes configuration digest", async () => {
    const compile = (language: string) =>
      compileRepositoryConfiguration(
        identity,
        reader({ ".holon.yml": JSON.stringify({ output: { language } }) }),
        parser,
      );
    const [en, es] = await Promise.all([compile("en"), compile("es")]);
    expect(en.scopeDigest).toBe(es.scopeDigest);
    expect(en.configDigest).not.toBe(es.configDigest);
  });
  it("fails closed on unavailable snapshots and missing references", async () => {
    await expect(
      compileRepositoryConfiguration(
        identity,
        {
          ...reader(),
          readFile: async () => ({ kind: "access_denied" as const }),
        },
        parser,
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
    await expect(
      compileRepositoryConfiguration(
        identity,
        reader({
          ".holon.yml": JSON.stringify({
            instructions: [{ path: "missing.md" }],
          }),
        }),
        parser,
      ),
    ).rejects.toMatchObject({ code: "missing_reference" });
  });
  it("applies UTF-8 byte limits independently of string length", async () => {
    await expect(
      compileRepositoryConfiguration(
        identity,
        reader({
          ".holon.yml": JSON.stringify({ instructions: ["é".repeat(9000)] }),
        }),
        parser,
      ),
    ).rejects.toMatchObject({ code: "budget_exceeded" });
  });
});

it("rejects forged run identity and sanitizes parser/structural errors", async () => {
  await expect(
    compileRepositoryConfiguration(
      { ...identity, repositoryId: 9 },
      reader(),
      parser,
    ),
  ).rejects.toMatchObject({ code: "identity_mismatch" });
  await expect(
    compileRepositoryConfiguration(
      identity,
      reader({ ".holon.yml": "private-invalid-json" }),
      parser,
    ),
  ).rejects.toMatchObject({ code: "invalid_yaml" });
  await expect(
    compileRepositoryConfiguration(
      identity,
      reader({ ".holon.yml": '{"output":{"language":"private-language"}}' }),
      parser,
    ),
  ).rejects.toMatchObject({
    code: "invalid_configuration",
    location: "/output/language",
  });
});

it.each(["\0", "version https://git-lfs.github.com/spec/v1"])(
  "refuses forbidden source bytes %#",
  async (content) => {
    await expect(
      compileRepositoryConfiguration(
        identity,
        reader({ ".holon.yml": content }),
        parser,
      ),
    ).rejects.toMatchObject({ code: "invalid_file" });
  },
);

it("checks root existence, compatibility grammar, excluded references and description bytes", async () => {
  await expect(
    compileRepositoryConfiguration(
      identity,
      {
        ...reader({
          ".holon.yml": '{"projects":[{"name":"api","root":"missing"}]}',
        }),
        directoryExists: async () => false,
      },
      parser,
    ),
  ).rejects.toMatchObject({ code: "missing_project_root" });
  await expect(
    compileRepositoryConfiguration(
      identity,
      reader({
        ".holon.yml":
          '{"projects":[{"name":"api","root":".","compatibility":{"runtimes":{"node":"nonsense"}}}]}',
      }),
      parser,
    ),
  ).rejects.toMatchObject({ code: "invalid_compatibility" });
  await expect(
    compileRepositoryConfiguration(
      identity,
      {
        ...reader({ ".holon.yml": '{"instructions":[{"path":".env"}]}' }),
        isReferenceAllowed: () => false,
      },
      parser,
    ),
  ).rejects.toMatchObject({ code: "excluded_reference" });
  await expect(
    compileRepositoryConfiguration(
      identity,
      reader({
        ".holon.yml": JSON.stringify({
          projects: [
            { name: "api", root: ".", description: "語".repeat(2000) },
          ],
        }),
      }),
      parser,
    ),
  ).rejects.toMatchObject({ code: "budget_exceeded" });
});

it("reads shared reference bytes once and preserves their separate context and instruction roles", async () => {
  const calls: string[] = [];
  const files = reader({
    ".holon.yml": JSON.stringify({
      instructions: [{ path: "guide.md" }, { path: "guide.md" }],
      review: { reference_files: ["guide.md", "guide.md"] },
    }),
    "guide.md": "private shared guide",
  });
  const snapshot = await compileRepositoryConfiguration(
    identity,
    {
      ...files,
      readFile: async (path) => {
        calls.push(path);
        return files.readFile(path);
      },
    },
    parser,
  );
  expect(calls.filter((path) => path === "guide.md")).toHaveLength(1);
  expect(snapshot.config.instructions).toHaveLength(2);
  expect(snapshot.config.references).toHaveLength(1);
  expect(snapshot.config.references[0]?.text).toBe("private shared guide");
});

it("enforces total source and instruction count budgets across sections", async () => {
  const paths = Array.from({ length: 9 }, (_, index) => `ref${index}.md`);
  await expect(
    compileRepositoryConfiguration(
      identity,
      reader({
        ".holon.yml": JSON.stringify({ review: { reference_files: paths } }),
        ...Object.fromEntries(paths.map((path) => [path, "a".repeat(32000)])),
      }),
      parser,
    ),
  ).rejects.toMatchObject({ code: "budget_exceeded", location: "sources" });
  await expect(
    compileRepositoryConfiguration(
      identity,
      reader({
        ".holon.yml": JSON.stringify({
          instructions: Array(200).fill("global"),
          projects: [{ name: "api", root: ".", instructions: ["project"] }],
        }),
      }),
      parser,
    ),
  ).rejects.toMatchObject({
    code: "budget_exceeded",
    location: "instructions",
  });
});

it("normalizes defaults/key order while preserving source provenance and compiler semantics", async () => {
  const compile = (source: string, compiler?: string) =>
    compileRepositoryConfiguration(
      identity,
      reader({ ".holon.yml": source }),
      parser,
      compiler,
    );
  const [implicit, explicit, revised] = await Promise.all([
    compile("{}"),
    compile(
      '{"output":{"max_inline_comments":40,"detail":"concise","language":"en"}}',
    ),
    compile("{}", "different-compiler"),
  ]);
  expect(implicit.configDigest).toBe(explicit.configDigest);
  expect(implicit.sourceDigest).not.toBe(explicit.sourceDigest);
  expect(revised.configDigest).not.toBe(implicit.configDigest);
  expect(revised.scopeDigest).toBe(implicit.scopeDigest);
});
