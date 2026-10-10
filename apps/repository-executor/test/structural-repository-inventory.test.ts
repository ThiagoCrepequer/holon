import { describe, expect, it, vi } from "vitest";

import type { SandboxPort } from "../src/sandbox-port.js";
import { collectStructuralRepositoryInventory } from "../src/structural-repository-inventory.js";

const modifiedExportPatch = [
  "diff --git a/src/service.ts b/src/service.ts",
  "--- a/src/service.ts",
  "+++ b/src/service.ts",
  "@@ -1,3 +1,3 @@",
  "-export function loadUser(id: string) {",
  "+export function loadUser(id: number) {",
  "   return id;",
  " }",
].join("\n");

function defaultLsTreeStdout(candidatePaths: readonly string[]): string {
  return candidatePaths
    .map(
      (path) =>
        `100644 blob aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa     100\t${path}\0`,
    )
    .join("");
}

function sandbox(
  searchResult: {
    exitCode: number;
    stdout: string;
    timedOut?: boolean;
    truncated: boolean;
  },
  lsTreeResult?: {
    exitCode?: number;
    stdout?: string;
    timedOut?: boolean;
    truncated?: boolean;
  },
) {
  const readFile = vi.fn((path: string) =>
    Promise.resolve(
      path.endsWith("consumer.ts")
        ? "import { loadUser ,} from './service';\nloadUser('42');"
        : "loadUser('duplicate');",
    ),
  );
  const run = vi.fn((args: readonly string[]) => {
    if (args[0] === "git") {
      if (lsTreeResult) {
        return Promise.resolve({
          exitCode: lsTreeResult.exitCode ?? 0,
          stderr: "",
          stdout: lsTreeResult.stdout ?? "",
          timedOut: lsTreeResult.timedOut ?? false,
          truncated: lsTreeResult.truncated ?? false,
        });
      }
      const dashDashIndex = args.indexOf("--");
      const candidatePaths =
        dashDashIndex >= 0 ? args.slice(dashDashIndex + 1) : [];
      return Promise.resolve({
        exitCode: 0,
        stderr: "",
        stdout: defaultLsTreeStdout(candidatePaths),
        timedOut: false,
        truncated: false,
      });
    }
    return Promise.resolve({ stderr: "", ...searchResult });
  });
  return {
    port: { readFile, run } as unknown as SandboxPort,
    readFile,
    run,
  };
}

describe("structural repository inventory", () => {
  it("explains omitted oversized modules without reporting repository paths or contents", async () => {
    const fake = sandbox(
      { exitCode: 1, stdout: "", truncated: false },
      { stdout: `100644 blob ${"a".repeat(40)} 64001\tsrc/service.ts\0` },
    );
    const observe = vi.fn();
    const result = await collectStructuralRepositoryInventory(
      fake.port,
      modifiedExportPatch,
      [],
      observe,
    );
    expect(result.truncated).toBe(true);
    expect(fake.readFile).not.toHaveBeenCalled();
    expect(observe).toHaveBeenCalledWith({
      selectedFiles: 0,
      readBytes: 0,
      truncated: true,
      limitationCodes: "file_bytes",
    });
    expect(JSON.stringify(observe.mock.calls)).not.toContain("src/service.ts");
  });
  it("covers 128 small edited modules within the unchanged byte budget", async () => {
    const fake = sandbox({ exitCode: 1, stdout: "", truncated: false });
    fake.readFile.mockResolvedValue(
      "export function loadUser(id: number) { return id; }",
    );
    const diff = Array.from({ length: 128 }, (_, index) =>
      modifiedExportPatch.replaceAll(
        "src/service.ts",
        `src/module-${index.toString().padStart(3, "0")}.ts`,
      ),
    ).join("\n");
    const result = await collectStructuralRepositoryInventory(fake.port, diff);
    expect(result.files).toHaveLength(128);
    expect(result.truncated).toBe(false);
  });
  it.each(["$load", "load$", "área", "用户"])(
    "discovers consumers of %s with an identifier-safe search",
    async (name) => {
      const fake = sandbox({ exitCode: 1, stdout: "", truncated: false });
      fake.readFile.mockImplementation(async (path) =>
        path.endsWith("consumer.ts")
          ? `${name}();`
          : `export function ${name}() {\n  return null;\n}`,
      );
      fake.run.mockImplementation(async (args) => {
        if (args[0] === "git")
          return {
            exitCode: 0,
            stderr: "",
            stdout: defaultLsTreeStdout(args.slice(args.indexOf("--") + 1)),
            truncated: false,
          };
        if (args[0] !== "rg") throw new Error("Unexpected inventory operation");
        const pattern = args[args.indexOf("--") + 1];
        if (!pattern) throw new Error("Missing inventory pattern");
        const search = new RegExp(pattern, "u");
        expect(search.test(`${name}();`)).toBe(true);
        expect(search.test(`prefix${name}suffix();`)).toBe(false);
        return {
          exitCode: 0,
          stderr: "",
          stdout: "src/consumer.ts\n",
          truncated: false,
        };
      });
      const patch = `diff --git a/src/producer.ts b/src/producer.ts\n--- a/src/producer.ts\n+++ b/src/producer.ts\n@@ -1,3 +1,3 @@\n export function ${name}() {\n-  return 1;\n+  return null;\n }`;
      const result = await collectStructuralRepositoryInventory(
        fake.port,
        patch,
      );
      expect(result.files.map((file) => file.path)).toEqual([
        "src/producer.ts",
        "src/consumer.ts",
      ]);
      expect(result.truncated).toBe(false);
    },
  );

  it("shares the byte budget between changed files and downstream reads", async () => {
    const fake = sandbox({
      exitCode: 0,
      stdout: "src/consumer.ts\n",
      truncated: false,
    });
    const patch = Array.from({ length: 19 }, (_, index) =>
      modifiedExportPatch.replaceAll(
        "src/service.ts",
        `src/service-${index}.ts`,
      ),
    ).join("\n");
    fake.run.mockImplementation(async (args) => {
      if (args[0] === "rg")
        return {
          exitCode: 0,
          stderr: "",
          stdout: "src/consumer.ts\n",
          truncated: false,
          timedOut: false,
        };
      const paths = args.slice(args.indexOf("--") + 1);
      return {
        exitCode: 0,
        stderr: "",
        stdout: paths
          .map(
            (path) =>
              `100644 blob ${"a".repeat(40)} ${path.endsWith("consumer.ts") ? 60000 : 50000}\t${path}\0`,
          )
          .join(""),
        truncated: false,
        timedOut: false,
      };
    });
    fake.readFile.mockResolvedValue("x".repeat(50_000));
    const inventory = await collectStructuralRepositoryInventory(
      fake.port,
      patch,
    );
    expect(inventory.files).toHaveLength(19);
    expect(inventory.truncated).toBe(true);
    expect(fake.readFile).not.toHaveBeenCalledWith(
      "/workspace/repository/src/consumer.ts",
    );
  });

  it("retains validated heads but refuses a downstream symlink", async () => {
    const fake = sandbox({
      exitCode: 0,
      stdout: "src/consumer.ts\n",
      truncated: false,
    });
    fake.run.mockImplementation(async (args) => {
      if (args[0] === "rg")
        return {
          exitCode: 0,
          stderr: "",
          stdout: "src/consumer.ts\n",
          truncated: false,
          timedOut: false,
        };
      const paths = args.slice(args.indexOf("--") + 1);
      return {
        exitCode: 0,
        stderr: "",
        stdout: paths
          .map(
            (path) =>
              `${path.endsWith("consumer.ts") ? "120000" : "100644"} blob ${"a".repeat(40)} 20\t${path}\0`,
          )
          .join(""),
        truncated: false,
        timedOut: false,
      };
    });
    const inventory = await collectStructuralRepositoryInventory(
      fake.port,
      modifiedExportPatch,
    );
    expect(inventory.files.map((file) => file.path)).toEqual([
      "src/service.ts",
    ]);
    expect(inventory.truncated).toBe(true);
    expect(fake.readFile).not.toHaveBeenCalledWith(
      "/workspace/repository/src/consumer.ts",
    );
  });

  it("discovers downstream paths after validating and reading a changed function body", async () => {
    const fake = sandbox({
      exitCode: 0,
      stdout: "./src/consumer.ts\n",
      truncated: false,
    });
    fake.readFile.mockImplementation(async (path) =>
      path.endsWith("producer.ts")
        ? "export function produce() {\n  return null;\n}"
        : "import { produce } from './producer';\nproduce().id;",
    );
    const patch =
      "diff --git a/src/producer.ts b/src/producer.ts\n--- a/src/producer.ts\n+++ b/src/producer.ts\n@@ -1,3 +1,3 @@\n export function produce() {\n-  return { id: 'ok' };\n+  return null;\n }";
    const result = await collectStructuralRepositoryInventory(fake.port, patch);
    expect(result.files.map((file) => file.path)).toEqual([
      "src/producer.ts",
      "src/consumer.ts",
    ]);
    const search = fake.run.mock.calls.find(([args]) => args[0] === "rg")?.[0];
    const pattern = search?.[search.indexOf("--") + 1];
    if (!pattern) throw new Error("Missing downstream search");
    expect(new RegExp(pattern, "u").test("produce().id;")).toBe(true);
    expect(new RegExp(pattern, "u").test("producer().id;")).toBe(false);
    expect(result.truncated).toBe(false);
  });
  it("loads bounded downstream candidate files from the real checkout", async () => {
    const fake = sandbox({
      exitCode: 0,
      stdout:
        "./src/service.ts\n./src/consumer.ts\n./node_modules/pkg/index.ts\n",
      truncated: false,
    });

    const inventory = await collectStructuralRepositoryInventory(
      fake.port,
      modifiedExportPatch,
    );

    expect(fake.run).toHaveBeenCalledWith(
      expect.arrayContaining([
        "rg",
        "--files-with-matches",
        "--no-messages",
        "--",
        ".",
      ]),
      expect.objectContaining({ cwd: "/workspace/repository" }),
    );
    const search = fake.run.mock.calls.find(([args]) => args[0] === "rg")?.[0];
    const pattern = search?.[search.indexOf("--") + 1];
    if (!pattern) throw new Error("Missing downstream search");
    expect(new RegExp(pattern, "u").test("loadUser('42');")).toBe(true);
    expect(new RegExp(pattern, "u").test("$loadUser('42');")).toBe(false);
    expect(inventory).toEqual({
      files: [
        {
          content: "loadUser('duplicate');",
          path: "src/service.ts",
        },
        {
          content: "import { loadUser ,} from './service';\nloadUser('42');",
          path: "src/consumer.ts",
        },
      ],
      truncated: false,
    });
    expect(fake.readFile).toHaveBeenCalledTimes(2);
    expect(fake.readFile).toHaveBeenNthCalledWith(
      1,
      "/workspace/repository/src/service.ts",
    );
  });

  it("marks the inventory incomplete when repository search fails but retains changed files", async () => {
    const fake = sandbox({
      exitCode: 2,
      stdout: "",
      timedOut: false,
      truncated: false,
    });

    await expect(
      collectStructuralRepositoryInventory(fake.port, modifiedExportPatch),
    ).resolves.toEqual({
      files: [
        {
          content: "loadUser('duplicate');",
          path: "src/service.ts",
        },
      ],
      truncated: true,
    });
  });

  it("marks truncated when 256 changed files exhaust candidate quota without downstream search", async () => {
    // Saturate the bounded changed-file quota before discovering consumers.
    const manyPatches = Array.from({ length: 256 }, (_, i) =>
      [
        `diff --git a/src/file${i}.ts b/src/file${i}.ts`,
        `--- a/src/file${i}.ts`,
        `+++ b/src/file${i}.ts`,
        "@@ -1,1 +1,1 @@",
        i === 0
          ? "-export function loadUser() {}"
          : "-export function other() {}",
        i === 0
          ? "+export function loadUser() { return 1; }"
          : "+export function other() { return 1; }",
      ].join("\n"),
    ).join("\n");

    const fake = sandbox({
      exitCode: 0,
      stdout: "./src/consumer.ts\n",
      truncated: false,
    });

    const inventory = await collectStructuralRepositoryInventory(
      fake.port,
      manyPatches,
    );

    expect(inventory.files).toHaveLength(256);
    expect(inventory.truncated).toBe(true);
    // rg should not be called because remainingQuota is 0
    expect(fake.run).not.toHaveBeenCalledWith(
      expect.arrayContaining(["rg"]),
      expect.anything(),
    );
  });

  it("skips individual files exceeding 64k bytes and marks inventory truncated", async () => {
    const fake = sandbox({
      exitCode: 0,
      stdout: "./src/consumer.ts\n",
      truncated: false,
    });
    fake.readFile.mockImplementation((path: string) => {
      if (path.endsWith("service.ts")) {
        return Promise.resolve("x".repeat(64_001));
      }
      return Promise.resolve("normal content");
    });

    const inventory = await collectStructuralRepositoryInventory(
      fake.port,
      modifiedExportPatch,
    );

    expect(inventory.truncated).toBe(true);
    expect(inventory.files).toEqual([
      { content: "normal content", path: "src/consumer.ts" },
    ]);
  });

  it("caps retained source and marks truncated when inventory exceeds 1MB", async () => {
    // 25 changed files, each 50k bytes: 20 files = 1,000,000 bytes, 21st file exceeds 1MB
    const manyPatches = Array.from({ length: 25 }, (_, i) =>
      [
        `diff --git a/src/file${i}.ts b/src/file${i}.ts`,
        `--- a/src/file${i}.ts`,
        `+++ b/src/file${i}.ts`,
        "@@ -1,1 +1,1 @@",
        "-export function loadUser() {}",
        "+export function loadUser() { return 1; }",
      ].join("\n"),
    ).join("\n");

    const fake = sandbox({
      exitCode: 1,
      stdout: "",
      truncated: false,
    });
    fake.readFile.mockImplementation(() => Promise.resolve("x".repeat(50_000)));

    const inventory = await collectStructuralRepositoryInventory(
      fake.port,
      manyPatches,
    );

    expect(inventory.truncated).toBe(true);
    expect(inventory.files).toHaveLength(20);
  });

  it("retains the full changed module when no downstream consumer matches", async () => {
    const fake = sandbox({ exitCode: 1, stdout: "", truncated: false });
    const source = "export function loadUser(id: number) { return id; }";
    fake.readFile.mockResolvedValue(source);
    await expect(
      collectStructuralRepositoryInventory(fake.port, modifiedExportPatch),
    ).resolves.toEqual({
      files: [{ path: "src/service.ts", content: source }],
      truncated: false,
    });
  });

  it("does not read a module deleted from HEAD", async () => {
    const patch = [
      "diff --git a/src/service.ts b/src/service.ts",
      "deleted file mode 100644",
      "--- a/src/service.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-export function loadUser() {}",
    ].join("\n");
    const fake = sandbox({ exitCode: 1, stdout: "", truncated: false });
    await expect(
      collectStructuralRepositoryInventory(fake.port, patch),
    ).resolves.toEqual({ files: [], truncated: false });
    expect(fake.readFile).not.toHaveBeenCalled();
  });

  it("marks missing changed source incomplete and retains downstream evidence", async () => {
    const fake = sandbox({
      exitCode: 0,
      stdout: "src/consumer.ts\n",
      truncated: false,
    });
    fake.readFile.mockImplementation(async (path) => {
      if (path.endsWith("service.ts"))
        throw new Error("Synthetic missing source");
      return "import { loadUser } from './service'; loadUser(1);";
    });
    const inventory = await collectStructuralRepositoryInventory(
      fake.port,
      modifiedExportPatch,
    );
    expect(inventory.truncated).toBe(true);
    expect(inventory.files.map((file) => file.path)).toEqual([
      "src/consumer.ts",
    ]);
  });

  it("prioritizes changed source inside the shared 256-file limit", async () => {
    const fake = sandbox({
      exitCode: 0,
      stdout: Array.from(
        { length: 257 },
        (_, i) => `src/a-consumer-${i}.ts`,
      ).join("\n"),
      truncated: false,
    });
    const inventory = await collectStructuralRepositoryInventory(
      fake.port,
      modifiedExportPatch,
    );
    expect(inventory.files).toHaveLength(256);
    expect(inventory.files[0]?.path).toBe("src/service.ts");
    expect(fake.readFile).toHaveBeenCalledTimes(256);
    expect(inventory.truncated).toBe(true);
  });

  it.each([16_000, 16_001])(
    "enforces the file limit in UTF-8 bytes: %i emoji",
    async (count) => {
      const fake = sandbox({ exitCode: 1, stdout: "", truncated: false });
      fake.readFile.mockResolvedValue("🙂".repeat(count));
      const inventory = await collectStructuralRepositoryInventory(
        fake.port,
        modifiedExportPatch,
      );
      expect(inventory.files).toHaveLength(count === 16_000 ? 1 : 0);
      expect(inventory.truncated).toBe(count !== 16_000);
    },
  );

  it("rejects changed symlink file (mode 120000 in HEAD) without reading external source and marks truncated", async () => {
    const fake = sandbox(
      { exitCode: 1, stdout: "", truncated: false },
      {
        stdout:
          "120000 blob aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa      25\tsrc/service.ts\0",
      },
    );
    fake.readFile.mockResolvedValue("// private external file content");

    const inventory = await collectStructuralRepositoryInventory(
      fake.port,
      modifiedExportPatch,
    );

    expect(fake.readFile).not.toHaveBeenCalled();
    expect(inventory.files).toEqual([]);
    expect(inventory.truncated).toBe(true);
  });

  it("skips oversized files in HEAD before reading and marks truncated", async () => {
    const fake = sandbox(
      { exitCode: 1, stdout: "", truncated: false },
      {
        stdout:
          "100644 blob aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa   65000\tsrc/service.ts\0",
      },
    );

    const inventory = await collectStructuralRepositoryInventory(
      fake.port,
      modifiedExportPatch,
    );

    expect(fake.readFile).not.toHaveBeenCalled();
    expect(inventory.files).toEqual([]);
    expect(inventory.truncated).toBe(true);
  });

  it("accepts executable regular files (mode 100755 in HEAD)", async () => {
    const fake = sandbox(
      { exitCode: 1, stdout: "", truncated: false },
      {
        stdout:
          "100755 blob aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa     100\tsrc/service.ts\0",
      },
    );
    const source = "export function loadUser(id: number) { return id; }";
    fake.readFile.mockResolvedValue(source);

    const inventory = await collectStructuralRepositoryInventory(
      fake.port,
      modifiedExportPatch,
    );

    expect(inventory.files).toEqual([
      { content: source, path: "src/service.ts" },
    ]);
    expect(inventory.truncated).toBe(false);
    expect(fake.readFile).toHaveBeenCalledWith(
      "/workspace/repository/src/service.ts",
    );
  });

  it("aborts reading and marks truncated when ls-tree output is marked truncated even with apparently valid record", async () => {
    const fake = sandbox(
      { exitCode: 1, stdout: "", truncated: false },
      {
        stdout:
          "100644 blob aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa     100\tsrc/service.ts\0",
        truncated: true,
      },
    );
    const inventory = await collectStructuralRepositoryInventory(
      fake.port,
      modifiedExportPatch,
    );
    expect(fake.readFile).not.toHaveBeenCalled();
    expect(inventory.files).toEqual([]);
    expect(inventory.truncated).toBe(true);
  });

  it("aborts reading and marks truncated when metadata size contains non-numeric suffix (1oops)", async () => {
    const fake = sandbox(
      { exitCode: 1, stdout: "", truncated: false },
      {
        stdout:
          "100644 blob aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa   1oops\tsrc/service.ts\0",
      },
    );
    const inventory = await collectStructuralRepositoryInventory(
      fake.port,
      modifiedExportPatch,
    );
    expect(fake.readFile).not.toHaveBeenCalled();
    expect(inventory.files).toEqual([]);
    expect(inventory.truncated).toBe(true);
  });

  it("aborts reading and marks truncated when metadata size is negative (-1)", async () => {
    const fake = sandbox(
      { exitCode: 1, stdout: "", truncated: false },
      {
        stdout:
          "100644 blob aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa      -1\tsrc/service.ts\0",
      },
    );
    const inventory = await collectStructuralRepositoryInventory(
      fake.port,
      modifiedExportPatch,
    );
    expect(fake.readFile).not.toHaveBeenCalled();
    expect(inventory.files).toEqual([]);
    expect(inventory.truncated).toBe(true);
  });

  it("aborts reading and marks truncated when hash is not 40 hex characters", async () => {
    const fake = sandbox(
      { exitCode: 1, stdout: "", truncated: false },
      {
        stdout:
          "100644 blob not-a-valid-40-hex-hash                   100\tsrc/service.ts\0",
      },
    );
    const inventory = await collectStructuralRepositoryInventory(
      fake.port,
      modifiedExportPatch,
    );
    expect(fake.readFile).not.toHaveBeenCalled();
    expect(inventory.files).toEqual([]);
    expect(inventory.truncated).toBe(true);
  });

  it("aborts reading and marks truncated when NUL terminator is missing from stdout", async () => {
    const fake = sandbox(
      { exitCode: 1, stdout: "", truncated: false },
      {
        stdout:
          "100644 blob aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa     100\tsrc/service.ts",
      },
    );
    const inventory = await collectStructuralRepositoryInventory(
      fake.port,
      modifiedExportPatch,
    );
    expect(fake.readFile).not.toHaveBeenCalled();
    expect(inventory.files).toEqual([]);
    expect(inventory.truncated).toBe(true);
  });

  it("aborts reading and marks truncated when ls-tree times out", async () => {
    const fake = sandbox(
      { exitCode: 1, stdout: "", truncated: false },
      { timedOut: true },
    );
    const inventory = await collectStructuralRepositoryInventory(
      fake.port,
      modifiedExportPatch,
    );
    expect(fake.readFile).not.toHaveBeenCalled();
    expect(inventory.files).toEqual([]);
    expect(inventory.truncated).toBe(true);
  });

  it("aborts reading and marks truncated when ls-tree exits with non-zero code", async () => {
    const fake = sandbox(
      { exitCode: 1, stdout: "", truncated: false },
      { exitCode: 128 },
    );
    const inventory = await collectStructuralRepositoryInventory(
      fake.port,
      modifiedExportPatch,
    );
    expect(fake.readFile).not.toHaveBeenCalled();
    expect(inventory.files).toEqual([]);
    expect(inventory.truncated).toBe(true);
  });
});
