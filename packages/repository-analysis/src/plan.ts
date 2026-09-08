import {
  reviewPlanSchema,
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

export function buildReviewPlan(
  diffFiles: readonly PullRequestDiffFile[],
  options?: BuildReviewPlanOptions,
): ReviewPlan {
  const maxShardDiffBytes = options?.maxShardDiffBytes ?? 60_000;
  const maxShardFiles = options?.maxShardFiles ?? 20;
  const maxShardLines = options?.maxShardLines ?? 1_500;
  const maxShards = options?.maxShards ?? 5;

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
          `All ${policyExcludedFilesCount} eligible file(s) in this pull request were excluded by repository policy.`,
        ],
        schemaVersion: 2,
        scopeStatus: "partial_by_policy",
        shards: [],
        totalEligibleBytes: 0,
        totalEligibleFiles: 0,
        totalEligibleLines: 0,
        unsupportedFilesCount: unsupportedFilesCount + policyExcludedFilesCount,
      });
    }
    return reviewPlanSchema.parse({
      omissionReasons: [
        "No supported or non-binary files found in the pull request diff.",
      ],
      schemaVersion: 2,
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

  let selectedFileCount = 0;
  let oversizedFileCount = 0;
  let omittedByFileLimit = 0;
  for (const item of balanceReviewModes(prioritizedFiles)) {
    if (item.patchBytes > maxShardDiffBytes) {
      oversizedFileCount += 1;
      continue;
    }
    if (selectedFileCount >= 50) {
      omittedByFileLimit += 1;
      continue;
    }
    selectedFileCount += 1;
    const wouldExceedBytes =
      currentShard.files.length > 0 &&
      currentShard.byteLength + item.patchBytes > maxShardDiffBytes;
    const wouldExceedFiles =
      currentShard.files.length > 0 &&
      currentShard.files.length + 1 > maxShardFiles;
    const wouldExceedLines =
      currentShard.files.length > 0 &&
      currentShard.changedLines.length + item.changedLines.length >
        maxShardLines;

    if (wouldExceedBytes || wouldExceedFiles || wouldExceedLines) {
      rawShards.push(currentShard);
      currentShard = {
        byteLength: 0,
        changedLines: [],
        files: [],
      };
    }

    currentShard.files.push(item.file);
    currentShard.byteLength += item.patchBytes;
    const remainingShardLines = 5_000 - currentShard.changedLines.length;
    if (remainingShardLines > 0) {
      currentShard.changedLines.push(
        ...item.changedLines.slice(0, remainingShardLines),
      );
    }
  }

  if (currentShard.files.length > 0) {
    rawShards.push(currentShard);
  }

  const omissionReasons: string[] = [];
  let scopeStatus: "complete" | "partial_by_policy" = "complete";

  if (oversizedFileCount > 0) {
    scopeStatus = "partial_by_policy";
    omissionReasons.push(
      `${oversizedFileCount} eligible file(s) omitted whole because their patches exceed the ${maxShardDiffBytes}-byte limit per shard.`,
    );
  }
  if (omittedByFileLimit > 0) {
    scopeStatus = "partial_by_policy";
    omissionReasons.push(
      `${omittedByFileLimit} eligible file(s) omitted by the 50-file limit across shards.`,
    );
  }
  if (policyExcludedFilesCount > 0) {
    scopeStatus = "partial_by_policy";
    omissionReasons.push(
      `${policyExcludedFilesCount} eligible file(s) excluded by repository policy.`,
    );
  }

  let selectedRawShards = rawShards;
  if (rawShards.length > maxShards) {
    selectedRawShards = rawShards.slice(0, maxShards);
    scopeStatus = "partial_by_policy";
    omissionReasons.push(
      `Review was bounded to the first ${maxShards} priority shards out of ${rawShards.length} planned shards by policy.`,
    );
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
    schemaVersion: 2,
    scopeStatus,
    shards,
    totalEligibleBytes,
    totalEligibleFiles,
    totalEligibleLines,
    unsupportedFilesCount,
  });
}
