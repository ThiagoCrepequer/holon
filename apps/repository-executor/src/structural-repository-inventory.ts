import type { DownstreamTracerFile } from "@holon/repository-analysis";
import {
  classifyPullRequestDiffFile,
  extractChangedSymbols,
  isNonBinaryPullRequestPatch,
  repositorySearchGlobs,
  selectReviewableFiles,
  splitPullRequestDiff,
  symbolReferencePattern,
} from "@holon/repository-analysis";

import { repositoryPath } from "./repository-tools.js";
import type { SandboxPort } from "./sandbox-port.js";

const maximumCandidateFiles = 256;
const maximumFileBytes = 64_000;
const maximumInventoryBytes = 1_000_000;

export interface StructuralRepositoryInventory {
  readonly files: readonly DownstreamTracerFile[];
  readonly truncated: boolean;
}

type InventoryLimitation =
  | "changed_file_capacity"
  | "consumer_file_capacity"
  | "consumer_search"
  | "git_metadata"
  | "metadata_missing"
  | "file_bytes"
  | "inventory_bytes"
  | "file_read";
interface InventoryDiagnostics {
  readonly selectedFiles: number;
  readonly readBytes: number;
  readonly truncated: boolean;
  readonly limitationCodes: string;
}

export async function collectStructuralRepositoryInventory(
  sandbox: SandboxPort,
  canonicalDiff: string,
  additionalExcludes: readonly string[] = [],
  observe?: (fields: InventoryDiagnostics) => void,
): Promise<StructuralRepositoryInventory> {
  const limitations = new Set<InventoryLimitation>();
  const mark = (reason: InventoryLimitation) => {
    limitations.add(reason);
  };
  const diffFiles = splitPullRequestDiff(canonicalDiff);
  const structuralDiffFiles = diffFiles.filter((file) => {
    const mode = classifyPullRequestDiffFile(file, additionalExcludes);
    return mode === "structural" && isNonBinaryPullRequestPatch(file.patch);
  });
  const changedFiles = structuralDiffFiles.map((file) => ({
    patch: file.patch,
    path: file.path,
  }));

  const changedModulePaths = structuralDiffFiles
    .filter((file) => file.changeType !== "deleted")
    .map((file) => file.path);

  const selectedChangedPaths = selectReviewableFiles(
    changedModulePaths,
    maximumCandidateFiles + 1,
    additionalExcludes,
  );
  let truncated = selectedChangedPaths.length > maximumCandidateFiles;
  if (truncated) mark("changed_file_capacity");
  const prioritizedChanged = selectedChangedPaths.slice(
    0,
    maximumCandidateFiles,
  );
  const remainingQuota = Math.max(
    0,
    maximumCandidateFiles - prioritizedChanged.length,
  );
  const changedPathSet = new Set(prioritizedChanged);

  const headInventory = await readInventoryFiles(
    sandbox,
    prioritizedChanged,
    maximumInventoryBytes,
    mark,
  );
  truncated ||= headInventory.truncated;
  const names = [
    ...new Set(
      extractChangedSymbols(changedFiles, headInventory.files)
        .filter(
          (symbol) =>
            symbol.isExported &&
            (symbol.change === "modified" || symbol.change === "deleted"),
        )
        .map((symbol) => symbol.name),
    ),
  ];

  let downstreamPaths: string[] = [];
  const pattern = symbolReferencePattern(names);
  if (pattern !== undefined) {
    if (remainingQuota === 0) {
      truncated = true;
      mark("consumer_file_capacity");
    } else {
      const globArguments = [
        ...repositorySearchGlobs.flatMap((glob) => ["--glob", glob]),
        ...additionalExcludes.flatMap((glob) => ["--glob", `!${glob}`]),
      ];
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
        if (search.truncated) {
          truncated = true;
          mark("consumer_search");
        }
      } else if (search.exitCode !== 0 || search.timedOut === true) {
        truncated = true;
        mark("consumer_search");
      } else {
        if (search.truncated) {
          truncated = true;
          mark("consumer_search");
        }
        downstreamPaths = search.stdout
          .split("\n")
          .map((path) => path.replace(/^\.\//u, "").trim())
          .filter((path) => path.length > 0 && !changedPathSet.has(path));
      }
    }
  }

  const selectedDownstreamPaths = selectReviewableFiles(
    downstreamPaths,
    remainingQuota + 1,
    additionalExcludes,
  );
  if (selectedDownstreamPaths.length > remainingQuota) {
    truncated = true;
    mark("consumer_file_capacity");
  }

  const downstreamInventory = await readInventoryFiles(
    sandbox,
    selectedDownstreamPaths.slice(0, remainingQuota),
    maximumInventoryBytes -
      headInventory.files.reduce(
        (bytes, file) =>
          bytes + new TextEncoder().encode(file.content).byteLength,
        0,
      ),
    mark,
  );
  const result = {
    files: [...headInventory.files, ...downstreamInventory.files],
    truncated: truncated || downstreamInventory.truncated,
  };
  try {
    observe?.({
      selectedFiles: result.files.length,
      readBytes: result.files.reduce(
        (sum, file) => sum + new TextEncoder().encode(file.content).byteLength,
        0,
      ),
      truncated: result.truncated,
      limitationCodes: [...limitations].toSorted().join(","),
    });
  } catch {
    /* Diagnostics do not authorize or invalidate reads. */
  }
  return result;
}

/** Validate exact Git entries before any read; share the byte cap across both passes. */
async function readInventoryFiles(
  sandbox: SandboxPort,
  candidatePaths: readonly string[],
  remainingBytes: number,
  mark: (reason: InventoryLimitation) => void,
): Promise<StructuralRepositoryInventory> {
  let truncated = false;
  if (candidatePaths.length === 0) {
    return { files: [], truncated };
  }

  const lsTree = await sandbox.run(
    [
      "git",
      "--literal-pathspecs",
      "ls-tree",
      "-r",
      "-l",
      "-z",
      "--full-tree",
      "HEAD",
      "--",
      ...candidatePaths,
    ],
    {
      cwd: repositoryPath,
      maxOutputBytes: 100_000,
      timeoutMs: 10_000,
    },
  );

  // Fail-safe: exit/error/timeout/truncated or incomplete NUL response => DO NOT read candidates
  if (lsTree.exitCode !== 0 || lsTree.timedOut === true || lsTree.truncated) {
    mark("git_metadata");
    return { files: [], truncated: true };
  }

  if (lsTree.stdout.length > 0 && !lsTree.stdout.endsWith("\0")) {
    mark("git_metadata");
    return { files: [], truncated: true };
  }

  const candidatePathSet = new Set(candidatePaths);
  const sizeByPath = new Map<string, number>();

  if (lsTree.stdout.length > 0) {
    const records = lsTree.stdout.split("\0");
    for (const record of records.slice(0, -1)) {
      const tabIndex = record.indexOf("\t");
      if (tabIndex === -1) {
        mark("git_metadata");
        return { files: [], truncated: true };
      }
      const meta = record.slice(0, tabIndex).trim();
      const filePath = record.slice(tabIndex + 1);

      if (!candidatePathSet.has(filePath)) {
        mark("git_metadata");
        return { files: [], truncated: true };
      }

      const parts = meta.split(/\s+/u);
      if (parts.length !== 4) {
        mark("git_metadata");
        return { files: [], truncated: true };
      }
      const [mode, type, sha, sizeStr] = parts;
      if (
        mode === undefined ||
        type === undefined ||
        sha === undefined ||
        sizeStr === undefined
      ) {
        mark("git_metadata");
        return { files: [], truncated: true };
      }

      // Validate SHA: exactly 40 lowercase hex characters
      if (!/^[0-9a-f]{40}$/u.test(sha)) {
        mark("git_metadata");
        return { files: [], truncated: true };
      }

      // Validate size: decimal digits only, non-negative, safe integer
      if (!/^\d+$/u.test(sizeStr)) {
        mark("git_metadata");
        return { files: [], truncated: true };
      }
      const size = Number(sizeStr);
      if (!Number.isSafeInteger(size) || size < 0) {
        mark("git_metadata");
        return { files: [], truncated: true };
      }

      // Validate mode & type:
      if (mode === "100644" || mode === "100755") {
        if (type !== "blob") {
          mark("git_metadata");
          return { files: [], truncated: true };
        }
        sizeByPath.set(filePath, size);
      } else {
        // Unsupported mode (e.g. 120000 symlink, 040000 tree, 160000 submodule)
        if (!/^\d{5,6}$/u.test(mode)) {
          mark("git_metadata");
          return { files: [], truncated: true };
        }
        // Valid Git record with unsupported mode: remains absent from sizeByPath
      }
    }
  }

  let totalBytes = 0;
  const files: DownstreamTracerFile[] = [];
  for (const path of candidatePaths) {
    const size = sizeByPath.get(path);
    if (size === undefined) {
      truncated = true;
      mark("metadata_missing");
      continue;
    }

    if (size > maximumFileBytes || totalBytes + size > remainingBytes) {
      truncated = true;
      mark(size > maximumFileBytes ? "file_bytes" : "inventory_bytes");
      continue;
    }

    try {
      const content = await sandbox.readFile(`${repositoryPath}/${path}`);
      const bytes = new TextEncoder().encode(content).byteLength;
      if (bytes > maximumFileBytes || totalBytes + bytes > remainingBytes) {
        truncated = true;
        mark(bytes > maximumFileBytes ? "file_bytes" : "inventory_bytes");
        continue;
      }
      totalBytes += bytes;
      files.push({ content, path });
    } catch {
      truncated = true;
      mark("file_read");
    }
  }
  return { files, truncated };
}
