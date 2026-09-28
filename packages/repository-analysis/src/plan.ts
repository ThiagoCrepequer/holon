import {
  reviewPlanSchema,
  reviewExecutionLimits,
  type ReviewContextFile,
  type ReviewFileMode,
  type ReviewPlan,
  type ReviewShard,
} from "@holon/contracts";
import type { ChangedLine } from "@holon/domain";

import {
  collectChangedLines,
  isNonBinaryPullRequestPatch,
  type PullRequestDiffFile,
} from "./diff.js";
import { evidenceWindowCount, partitionPatch } from "./patch-partition.js";
import { classifyPullRequestDiffFile } from "./policy.js";
import { mapReviewSurface } from "./surface.js";

export interface BuildReviewPlanOptions {
  readonly additionalExcludes?: readonly string[] | undefined;
  readonly maxShardDiffBytes?: number | undefined;
  readonly maxShardFiles?: number | undefined;
  readonly maxShardLines?: number | undefined;
  readonly maxShards?: number | undefined;
  readonly policyExcludedFilesCount?: number | undefined;
}

interface EligibleFile {
  readonly changedLines: readonly ChangedLine[];
  readonly directory: string;
  readonly file: ReviewContextFile;
  readonly mode: ReviewFileMode;
  readonly patchBytes: number;
}

// Preserve an initial opportunity for both modes and the existing 3:1 preference.
function balanceReviewModes(files: readonly EligibleFile[]): EligibleFile[] {
  const structural = files.filter((file) => file.mode === "structural");
  const textual = files.filter((file) => file.mode === "textual");
  const selected: EligibleFile[] = [];
  let structuralIndex = 0;
  let textualIndex = 0;
  const take = (mode: "structural" | "textual") => {
    const file =
      mode === "structural"
        ? structural[structuralIndex++]
        : textual[textualIndex++];
    if (file) selected.push(file);
  };
  take("structural");
  take("textual");
  while (structuralIndex < structural.length || textualIndex < textual.length) {
    for (let index = 0; index < 3; index += 1) take("structural");
    take("textual");
  }
  return selected;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function extractDirectory(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? "" : path.slice(0, lastSlash);
}

// Pair mirrored source/test trees within the same project. This is locality,
// not proof that files with different names are semantically independent.
function relatedFileKey(path: string): string {
  return path
    .replace(
      /^(?:(apps\/[^/]+\/|packages\/[^/]+\/))?(?:src|test|tests|__tests__)\//u,
      "$1",
    )
    .replace(/\.(?:test|spec)(?=\.[^.]+$)/u, "")
    .replace(/\.[^./]+$/u, "");
}

export function buildReviewPlan(
  diffFiles: readonly PullRequestDiffFile[],
  options?: BuildReviewPlanOptions,
): ReviewPlan {
  const maxShardDiffBytes =
    options?.maxShardDiffBytes ?? reviewExecutionLimits.shardPatchBytes;
  const maxShardFiles =
    options?.maxShardFiles ?? reviewExecutionLimits.shardFiles;
  const maxShardLines =
    options?.maxShardLines ?? reviewExecutionLimits.shardLines;
  const maxShards = options?.maxShards ?? reviewExecutionLimits.maxShards;

  let unsupportedFilesCount = 0;
  let policyExcludedFilesCount = options?.policyExcludedFilesCount ?? 0;
  const eligibleFiles: EligibleFile[] = [];

  for (const file of diffFiles) {
    const globalMode = classifyPullRequestDiffFile(file);
    if (globalMode === undefined || !isNonBinaryPullRequestPatch(file.patch)) {
      unsupportedFilesCount += 1;
      continue;
    }
    const mode = classifyPullRequestDiffFile(file, options?.additionalExcludes);
    if (mode === undefined) {
      policyExcludedFilesCount += 1;
      continue;
    }
    const patchBytes = utf8ByteLength(file.patch);
    const changedLines = collectChangedLines(file.path, file.patch);
    eligibleFiles.push({
      changedLines,
      directory: extractDirectory(file.path),
      file: {
        mode,
        patch: file.patch,
        path: file.path,
      },
      mode,
      patchBytes,
    });
  }

  if (eligibleFiles.length === 0) {
    if (policyExcludedFilesCount > 0) {
      return reviewPlanSchema.parse({
        omissionReasons: [
          { code: "all_excluded", count: policyExcludedFilesCount },
        ],
        scopeStatus: "partial_by_policy",
        shards: [],
        totalEligibleBytes: 0,
        totalEligibleFiles: 0,
        totalEligibleLines: 0,
        unsupportedFilesCount: unsupportedFilesCount + policyExcludedFilesCount,
      });
    }
    return reviewPlanSchema.parse({
      omissionReasons: [{ code: "unsupported" }],
      scopeStatus: "unsupported",
      shards: [],
      totalEligibleBytes: 0,
      totalEligibleFiles: 0,
      totalEligibleLines: 0,
      unsupportedFilesCount,
    });
  }

  const totalEligibleBytes = eligibleFiles.reduce(
    (total, file) => total + file.patchBytes,
    0,
  );
  const totalEligibleLines = eligibleFiles.reduce(
    (total, file) => total + file.changedLines.length,
    0,
  );
  const totalEligibleFiles = eligibleFiles.length;

  // Group by directory locality and prioritize structural files
  const groupedByDirectory = new Map<string, EligibleFile[]>();
  for (const item of eligibleFiles) {
    const existing = groupedByDirectory.get(item.directory) ?? [];
    existing.push(item);
    groupedByDirectory.set(item.directory, existing);
  }

  // Sort within directories: structural first, then alphabetical path
  for (const [dir, items] of groupedByDirectory.entries()) {
    groupedByDirectory.set(
      dir,
      items.toSorted((left, right) => {
        if (left.mode !== right.mode) {
          return left.mode === "structural" ? -1 : 1;
        }
        return left.file.path.localeCompare(right.file.path);
      }),
    );
  }

  // Sort directories: directories with structural files first
  const sortedDirectories = Array.from(groupedByDirectory.keys()).toSorted(
    (leftDir, rightDir) => {
      const leftFiles = groupedByDirectory.get(leftDir)!;
      const rightFiles = groupedByDirectory.get(rightDir)!;
      const leftHasStructural = leftFiles.some(
        (file) => file.mode === "structural",
      );
      const rightHasStructural = rightFiles.some(
        (file) => file.mode === "structural",
      );
      if (leftHasStructural !== rightHasStructural) {
        return leftHasStructural ? -1 : 1;
      }
      return leftDir.localeCompare(rightDir);
    },
  );

  const prioritizedFiles: EligibleFile[] = [];
  for (const dir of sortedDirectories) {
    prioritizedFiles.push(...groupedByDirectory.get(dir)!);
  }

  // Partition into shards
  const rawShards: Array<{
    byteLength: number;
    changedLines: ChangedLine[];
    files: ReviewContextFile[];
  }> = [];

  let currentShard: {
    byteLength: number;
    changedLines: ChangedLine[];
    files: ReviewContextFile[];
  } = {
    byteLength: 0,
    changedLines: [],
    files: [],
  };

  let oversizedFileCount = 0;

  const relatedGroups = new Map<string, EligibleFile[]>();
  for (const file of prioritizedFiles) {
    const key = relatedFileKey(file.file.path);
    const group = relatedGroups.get(key) ?? [];
    group.push(file);
    relatedGroups.set(key, group);
  }
  // Balance whole groups so textual coverage cannot separate a source/test pair.
  const groups = balanceReviewModes(
    [...relatedGroups.values()].map((group) => group[0]!),
  ).map((first) => relatedGroups.get(relatedFileKey(first.file.path))!);
  for (const group of groups) {
    const groupBytes = group.reduce((sum, file) => sum + file.patchBytes, 0);
    const groupLines = group.reduce(
      (sum, file) => sum + file.changedLines.length,
      0,
    );
    const groupWindows = group.reduce(
      (sum, file) => sum + evidenceWindowCount(file.file.patch),
      0,
    );
    const fitsEmptyShard =
      group.length <= maxShardFiles &&
      groupBytes <= maxShardDiffBytes &&
      groupLines <= maxShardLines &&
      groupWindows <= reviewExecutionLimits.shardEvidenceWindows;
    const fitsCurrentShard =
      currentShard.files.length + group.length <= maxShardFiles &&
      currentShard.byteLength + groupBytes <= maxShardDiffBytes &&
      currentShard.changedLines.length + groupLines <= maxShardLines &&
      currentShard.files.reduce(
        (sum, file) => sum + evidenceWindowCount(file.patch),
        0,
      ) +
        groupWindows <=
        reviewExecutionLimits.shardEvidenceWindows;
    if (currentShard.files.length && fitsEmptyShard && !fitsCurrentShard) {
      rawShards.push(currentShard);
      currentShard = { byteLength: 0, changedLines: [], files: [] };
    }
    for (const original of group) {
      const partition = partitionPatch(
        original.file.patch,
        maxShardDiffBytes,
        maxShardLines,
      );
      if (partition.omittedLines) oversizedFileCount++;
      for (const patch of partition.patches) {
        const item = {
          ...original,
          file: { ...original.file, patch },
          patchBytes: utf8ByteLength(patch),
          changedLines: collectChangedLines(original.file.path, patch),
        };
        const existingIndex = currentShard.files.findIndex(
          (file) => file.path === item.file.path,
        );
        const bodyStart = patch.search(/^@@ /mu);
        const appendedPatch =
          existingIndex >= 0 && bodyStart >= 0 ? patch.slice(bodyStart) : patch;
        const addedBytes = utf8ByteLength(appendedPatch);
        const wouldExceedWindows =
          currentShard.files.reduce(
            (sum, file) => sum + evidenceWindowCount(file.patch),
            0,
          ) +
            evidenceWindowCount(patch) >
          reviewExecutionLimits.shardEvidenceWindows;
        const wouldExceedBytes =
          currentShard.files.length > 0 &&
          currentShard.byteLength + addedBytes > maxShardDiffBytes;
        const wouldExceedFiles =
          currentShard.files.length > 0 &&
          currentShard.files.length + Number(existingIndex < 0) > maxShardFiles;
        const wouldExceedLines =
          currentShard.files.length > 0 &&
          currentShard.changedLines.length + item.changedLines.length >
            maxShardLines;

        if (
          wouldExceedBytes ||
          wouldExceedFiles ||
          wouldExceedLines ||
          wouldExceedWindows
        ) {
          rawShards.push(currentShard);
          currentShard = {
            byteLength: 0,
            changedLines: [],
            files: [],
          };
        }

        const mergeIndex = currentShard.files.findIndex(
          (file) => file.path === item.file.path,
        );
        if (mergeIndex >= 0) {
          currentShard.files[mergeIndex] = {
            ...item.file,
            patch:
              currentShard.files[mergeIndex]!.patch +
              (currentShard.files[mergeIndex]!.patch.endsWith("\n")
                ? ""
                : "\n") +
              appendedPatch,
          };
        } else currentShard.files.push(item.file);
        currentShard.byteLength = currentShard.files.reduce(
          (sum, file) => sum + utf8ByteLength(file.patch),
          0,
        );
        currentShard.changedLines.push(...item.changedLines);
      }
    }
  }

  if (currentShard.files.length > 0) {
    rawShards.push(currentShard);
  }

  const omissionReasons: ReviewPlan["omissionReasons"] = [];
  let scopeStatus: "complete" | "partial_by_policy" = "complete";

  if (oversizedFileCount > 0) {
    scopeStatus = "partial_by_policy";
    omissionReasons.push({
      code: "oversized_patches",
      count: oversizedFileCount,
      bytes: maxShardDiffBytes,
    });
  }
  if (policyExcludedFilesCount > 0) {
    scopeStatus = "partial_by_policy";
    omissionReasons.push({
      code: "policy_excluded",
      count: policyExcludedFilesCount,
    });
  }

  let selectedRawShards = rawShards;
  if (rawShards.length > maxShards) {
    selectedRawShards = rawShards.slice(0, maxShards);
    scopeStatus = "partial_by_policy";
    omissionReasons.push({
      code: "shard_limit",
      maximum: maxShards,
      planned: rawShards.length,
    });
  }

  const totalShards = selectedRawShards.length;
  const shards: ReviewShard[] = selectedRawShards.map((raw, index) => {
    const structuralFiles = raw.files.filter(
      (file) => file.mode === "structural",
    );
    const surface = mapReviewSurface(structuralFiles, 50);
    return {
      byteLength: raw.byteLength,
      changedLines: [...raw.changedLines],
      files: [...raw.files],
      id: `shard-${index}`,
      index,
      surface: [...surface],
      totalShards,
    };
  });

  return reviewPlanSchema.parse({
    omissionReasons,

    scopeStatus,
    shards,
    totalEligibleBytes,
    totalEligibleFiles,
    totalEligibleLines,
    unsupportedFilesCount,
  });
}
