import { describe, it, expect, vi } from "vitest";

import {
  collectProjectMetadata,
  metadataAuthorityPath,
} from "../src/project-metadata.js";
import { reviewScopePolicyPath } from "../src/repository-tools.js";
import type { SandboxPort } from "../src/sandbox-port.js";
const sha = "a".repeat(40),
  blob = "b".repeat(40),
  runId = `github:42:pr:7:head:${sha}`;
const request = {
  schemaVersion: 1,
  runId,
  repositoryId: 42,
  installationId: 9,
  snapshotSha: sha,
  policyDigest: "policy",
  modelRevision: "model",
  mode: "all-projects",
};
function sandbox(
  path = "package.json",
  mode = "100644",
  content = '{"dependencies":{"react":"19.0.0"}}',
) {
  const run = vi.fn().mockImplementation(async (argv: string[]) => ({
    exitCode: 0,
    stderr: "",
    truncated: false,
    stdout:
      argv[1] === "ls-tree"
        ? `${mode} blob ${blob} ${new TextEncoder().encode(content).length}\t${path}\0`
        : content,
  }));
  const readFile = vi.fn().mockImplementation(async (filePath: string) =>
    filePath === metadataAuthorityPath
      ? JSON.stringify({
          schemaVersion: 1,
          runId,
          repositoryId: 42,
          installationId: 9,
          headSha: sha,
          baseSha: "c".repeat(40),
          policyDigest: "policy",
          changedPaths: ["index.ts"],
        })
      : filePath === reviewScopePolicyPath
        ? JSON.stringify({
            schemaVersion: 2,
            additionalExcludes: [],
            deniedPaths: [],
          })
        : "",
  );
  const port: SandboxPort = {
    run,
    readFile,
    writeFile: vi.fn(),
    exists: vi.fn(),
    destroy: vi.fn(),
    configureGitHubEgress: vi.fn(),
    blockGitHubEgress: vi.fn(),
  };
  return { port, run, readFile };
}
describe("project metadata authority and bounded blobs", () => {
  it("reads exact Git blobs without executing repository content", async () => {
    const { port, run } = sandbox();
    const r = await collectProjectMetadata(port, request);
    expect(r.projects[0]?.technologies[0]?.name).toBe("react");
    expect(run.mock.calls[1]?.[0]).toEqual(["git", "cat-file", "blob", blob]);
  });
  it.each([
    { repositoryId: 43 },
    { installationId: 10 },
    { snapshotSha: "d".repeat(40) },
    { policyDigest: "other" },
    { runId: `github:42:pr:8:head:${sha}` },
  ])("rejects mismatched authority %s", async (change) => {
    const { port, run } = sandbox();
    await expect(
      collectProjectMetadata(port, { ...request, ...change }),
    ).rejects.toThrow("PROJECT_METADATA_AUTHORITY");
    expect(run).not.toHaveBeenCalled();
  });
  it.each([
    ".env",
    "node_modules/package-lock.json",
    "vendor/pnpm-lock.yaml",
    "../package.json",
  ])("does not read excluded %s", async (path) => {
    const { port, run } = sandbox(path);
    expect((await collectProjectMetadata(port, request)).projects).toEqual([]);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("does not follow symlinks", async () => {
    const { port, run } = sandbox("package.json", "120000");
    expect((await collectProjectMetadata(port, request)).limitations).toContain(
      "non-regular-source",
    );
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("honors additional exclusions even on lockfiles", async () => {
    const { port, readFile, run } = sandbox("package-lock.json");
    readFile.mockImplementation(async (filePath: string) =>
      filePath === metadataAuthorityPath
        ? JSON.stringify({
            schemaVersion: 1,
            runId,
            repositoryId: 42,
            installationId: 9,
            headSha: sha,
            baseSha: "c".repeat(40),
            policyDigest: "policy",
          })
        : JSON.stringify({
            schemaVersion: 2,
            additionalExcludes: ["package-lock.json"],
            deniedPaths: [],
          }),
    );
    expect((await collectProjectMetadata(port, request)).limitations).toContain(
      "source-excluded",
    );
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("fails explicitly on unavailable tree and skips incomplete blobs", async () => {
    const s = sandbox();
    s.run.mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "private",
      truncated: false,
    });
    await expect(collectProjectMetadata(s.port, request)).rejects.toThrow(
      "PROJECT_METADATA_UNAVAILABLE",
    );
    const b = sandbox();
    b.run
      .mockResolvedValueOnce({
        exitCode: 0,
        stderr: "",
        stdout: `100644 blob ${blob} 10\tpackage.json\0`,
        truncated: true,
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stderr: "",
        stdout: "bad",
        truncated: true,
      });
    const r = await collectProjectMetadata(b.port, request);
    expect(r.limitations).toEqual([
      "inventory-truncated",
      "source-unavailable",
    ]);
  });
  it("skips oversized sources and LFS pointers", async () => {
    const big = sandbox("package.json", "100644", "x".repeat(65537));
    expect(
      (await collectProjectMetadata(big.port, request)).limitations,
    ).toContain("source-size-limit");
    const lfs = sandbox(
      "package.json",
      "100644",
      "version https://git-lfs.github.com/spec/v1",
    );
    expect(
      (await collectProjectMetadata(lfs.port, request)).limitations,
    ).toContain("lfs-source-unavailable");
  });
});
it("stops collecting blobs after the shared stage deadline", async () => {
  const s = sandbox();
  const result = await collectProjectMetadata(s.port, {
    ...request,
    deadlineAt: 1,
  });
  expect(result.limitations).toContain("identification-deadline");
  expect(s.run).toHaveBeenCalledTimes(1);
});
