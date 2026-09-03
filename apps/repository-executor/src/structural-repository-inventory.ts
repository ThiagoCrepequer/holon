import type { DownstreamTracerFile } from "@holon/repository-analysis";
import {
  classifyPullRequestDiffFile,
  extractChangedSymbols,
  isNonBinaryPullRequestPatch,
  repositorySearchGlobs,
  selectReviewableFiles,
  splitPullRequestDiff,
} from "@holon/repository-analysis";

import { repositoryPath } from "./repository-tools.js";
import type { SandboxPort } from "./sandbox-port.js";

const maximumCandidateFiles = 100;
const maximumFileBytes = 64_000;
const maximumInventoryBytes = 1_000_000;

export interface StructuralRepositoryInventory {
  readonly files: readonly DownstreamTracerFile[];
  readonly truncated: boolean;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export async function collectStructuralRepositoryInventory(
  sandbox: SandboxPort,
  canonicalDiff: string,
): Promise<StructuralRepositoryInventory> {
  const changedFiles = splitPullRequestDiff(canonicalDiff).flatMap((file) => {
    const mode = classifyPullRequestDiffFile(file);
    return mode === "structural" && isNonBinaryPullRequestPatch(file.patch)
      ? [{ patch: file.patch, path: file.path }]
      : [];
  });
  const changedPaths = new Set(changedFiles.map((file) => file.path));
  const names = [
    ...new Set(
      extractChangedSymbols(changedFiles)
        .filter(
          (symbol) =>
            symbol.isExported &&
            (symbol.change === "modified" || symbol.change === "deleted"),
        )
        .map((symbol) => symbol.name),
    ),
  ];
  if (names.length === 0) return { files: [], truncated: false };

  const pattern = `\\b(?:${names.map(escapeRegex).join("|")})\\b`;
  const globArguments = repositorySearchGlobs.flatMap((glob) => [
    "--glob",
    glob,
  ]);
  const search = await sandbox.run(
    [
      "rg",
      "--files-with-matches",
      "--no-messages",
      ...globArguments,
      "--",
      pattern,
      ".",
    ],
    {
      cwd: repositoryPath,
      maxOutputBytes: 100_000,
      timeoutMs: 10_000,
    },
  );
  if (search.exitCode === 1 && search.timedOut !== true) {
    return { files: [], truncated: search.truncated };
  }
  if (search.exitCode !== 0 || search.timedOut === true) {
    return { files: [], truncated: true };
  }

  const candidates = selectReviewableFiles(
    search.stdout
      .split("\n")
      .map((path) => path.replace(/^\.\//u, "").trim())
      .filter((path) => path.length > 0 && !changedPaths.has(path)),
    maximumCandidateFiles + 1,
  );
  let truncated = search.truncated || candidates.length > maximumCandidateFiles;
  let totalBytes = 0;
  const files: DownstreamTracerFile[] = [];
  for (const path of candidates.slice(0, maximumCandidateFiles)) {
    try {
      const content = await sandbox.readFile(`${repositoryPath}/${path}`);
      const bytes = new TextEncoder().encode(content).byteLength;
      if (
        bytes > maximumFileBytes ||
        totalBytes + bytes > maximumInventoryBytes
      ) {
        truncated = true;
        continue;
      }
      totalBytes += bytes;
      files.push({ content, path });
    } catch {
      truncated = true;
    }
  }
  return { files, truncated };
}
