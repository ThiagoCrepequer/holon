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

function sandbox(searchResult: {
  exitCode: number;
  stdout: string;
  timedOut?: boolean;
  truncated: boolean;
}) {
  const readFile = vi.fn((path: string) =>
    Promise.resolve(
      path.endsWith("consumer.ts")
        ? "import { loadUser ,} from './service';\nloadUser('42');"
        : "loadUser('duplicate');",
    ),
  );
  const run = vi.fn().mockResolvedValue({ stderr: "", ...searchResult });
  return {
    port: { readFile, run } as unknown as SandboxPort,
    readFile,
    run,
  };
}

describe("structural repository inventory", () => {
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
        "\\b(?:loadUser)\\b",
        ".",
      ]),
      expect.objectContaining({ cwd: "/workspace/repository" }),
    );
    expect(inventory).toEqual({
      files: [
        {
          content: "import { loadUser ,} from './service';\nloadUser('42');",
          path: "src/consumer.ts",
        },
      ],
      truncated: false,
    });
    expect(fake.readFile).toHaveBeenCalledTimes(1);
  });

  it("marks the inventory incomplete when repository search fails", async () => {
    const fake = sandbox({
      exitCode: 2,
      stdout: "",
      timedOut: false,
      truncated: false,
    });

    await expect(
      collectStructuralRepositoryInventory(fake.port, modifiedExportPatch),
    ).resolves.toEqual({ files: [], truncated: true });
  });
});
