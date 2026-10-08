import {
  reviewExecutionLimits,
  type ReviewContextFile,
  type ReviewShard,
  type StructuralImpactReport,
} from "@holon/contracts";

import { collectChangedLines } from "./diff.js";
import { evidenceWindowCount, partitionPatch } from "./patch-partition.js";
import { mapReviewSurface } from "./surface.js";

function containsLine(patch: string, line: number): boolean {
  return [...patch.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gmu)].some(
    (match) => {
      const start = Number(match[1]);
      return line >= start && line < start + Number(match[2] ?? 1);
    },
  );
}
/** Bounded canonical windows investigate relationships that partitioning separated. */
export function buildContractChecks(
  shards: readonly ReviewShard[],
  files: readonly ReviewContextFile[],
  impact: StructuralImpactReport | undefined,
  maxShards: number,
  maxBytes: number,
  maxLines: number,
  maxFiles: number,
) {
  const checks: ReviewShard[] = [];
  let omitted = 0;
  const seen = new Set<string>();
  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const reference of impact?.downstreamReferences ?? []) {
    const caller = byPath.get(reference.callerPath);
    const target = byPath.get(reference.targetPath);
    if (!caller || !target || caller.path === target.path) continue;
    const symbol = impact?.changedSymbols.find(
      (item) => item.path === target.path && item.name === reference.symbolName,
    );
    if (!symbol) continue;
    const key = `${target.path}:${symbol.line}:${caller.path}:${reference.callerLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (
      shards.some(
        (shard) =>
          shard.files.some(
            (file) =>
              file.path === target.path &&
              containsLine(file.patch, symbol.line),
          ) &&
          shard.files.some(
            (file) =>
              file.path === caller.path &&
              containsLine(file.patch, reference.callerLine),
          ),
      )
    )
      continue;
    if (
      checks.length >= 8 ||
      shards.length + checks.length >= maxShards ||
      maxFiles < 2 ||
      maxLines < 2
    ) {
      omitted++;
      continue;
    }
    const windows = [target, caller].map((file, index) => {
      const pieces = partitionPatch(
        file.patch,
        Math.floor(maxBytes / 2),
        Math.min(80, Math.floor(maxLines / 2)),
      );
      const line = index === 0 ? symbol.line : reference.callerLine;
      const patch = pieces.patches.find((piece) => containsLine(piece, line));
      return patch ? { ...file, patch } : undefined;
    });
    if (windows.some((file) => file === undefined)) {
      omitted++;
      continue;
    }
    const selected = windows.filter((file) => file !== undefined);
    if (
      selected.reduce((sum, file) => sum + evidenceWindowCount(file.patch), 0) >
      reviewExecutionLimits.shardEvidenceWindows
    ) {
      omitted++;
      continue;
    }
    checks.push({
      id: `contract-check-${checks.length}`,
      index: shards.length + checks.length,
      totalShards: 1,
      byteLength: selected.reduce(
        (sum, file) => sum + new TextEncoder().encode(file.patch).byteLength,
        0,
      ),
      changedLines: selected.flatMap((file) =>
        collectChangedLines(file.path, file.patch),
      ),
      files: selected,
      surface: [
        ...mapReviewSurface(
          selected.filter((file) => file.mode === "structural"),
          50,
        ),
      ],
    });
  }
  return { checks, omitted };
}
