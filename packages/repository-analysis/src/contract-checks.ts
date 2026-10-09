import {
  reviewExecutionLimits,
  type ReviewContextFile,
  type ReviewShard,
  type StructuralImpactReport,
} from "@holon/contracts";
import { selectStructuralImpact, structuralImpactFits } from "@holon/domain";

import { collectChangedLines } from "./diff.js";
import { evidenceWindowCount, partitionPatch } from "./patch-partition.js";
import { mapReviewSurface } from "./surface.js";

function containsLine(
  patch: string,
  line: number,
  side: "LEFT" | "RIGHT" = "RIGHT",
): boolean {
  return [
    ...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gmu),
  ].some((match) => {
    const start = Number(match[side === "LEFT" ? 1 : 3]);
    const count = Number(match[side === "LEFT" ? 2 : 4] ?? 1);
    return line >= start && line < start + count;
  });
}

function shardContent(files: ReviewContextFile[]) {
  return {
    files,
    byteLength: files.reduce(
      (sum, file) => sum + new TextEncoder().encode(file.patch).byteLength,
      0,
    ),
    changedLines: files.flatMap((file) =>
      collectChangedLines(file.path, file.patch),
    ),
    surface: [
      ...mapReviewSurface(
        files.filter((file) => file.mode === "structural"),
        50,
      ),
    ],
  };
}

function combineWindows(
  existing: ReviewShard,
  incoming: ReviewContextFile[],
  maxBytes: number,
  maxLines: number,
  maxFiles: number,
  impact: StructuralImpactReport | undefined,
) {
  const files = [...existing.files];
  for (const file of incoming) {
    const prior = files.find((entry) => entry.path === file.path);
    // Different windows of the same file stay separate: do not concatenate
    // overlapping hunks or silently replace a previously admitted window.
    if (prior && prior.patch !== file.patch) return undefined;
    if (!prior) files.push(file);
  }
  const content = shardContent(files);
  if (
    content.files.length > maxFiles ||
    content.byteLength > maxBytes ||
    content.changedLines.length > maxLines ||
    files.reduce((sum, file) => sum + evidenceWindowCount(file.patch), 0) >
      reviewExecutionLimits.shardEvidenceWindows ||
    !structuralImpactFits(
      impact
        ? selectStructuralImpact(
            impact,
            files.map((file) => file.path),
          )
        : undefined,
    )
  )
    return undefined;
  return content;
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
  const reasons = { capacity: 0, missingWindow: 0, evidenceWindows: 0 };
  const seen = new Set<string>();
  const byPath = new Map(files.map((file) => [file.path, file]));
  const relationships = new Map<
    string,
    NonNullable<StructuralImpactReport["downstreamReferences"]>
  >();
  for (const reference of impact?.downstreamReferences ?? []) {
    const key = JSON.stringify([
      reference.targetPath,
      reference.symbolName,
      reference.callerPath,
    ]);
    const entries = relationships.get(key) ?? [];
    entries.push(reference);
    relationships.set(key, entries);
  }
  // An unchanged import is a discovery lead. When canonical uses exist, check
  // their windows instead; repeated lines in an already-covered window add no work.
  const references = [...relationships.values()].flatMap((entries) => {
    const caller = byPath.get(entries[0]!.callerPath);
    const canonical = entries.filter(
      (entry) => caller && containsLine(caller.patch, entry.callerLine),
    );
    return canonical.length ? canonical : entries;
  });
  for (const reference of references) {
    const caller = byPath.get(reference.callerPath);
    const target = byPath.get(reference.targetPath);
    if (!caller || !target || caller.path === target.path) continue;
    const symbol = impact?.changedSymbols.find(
      (item) => item.path === target.path && item.name === reference.symbolName,
    );
    if (!symbol) continue;
    const targetLine =
      symbol.change === "deleted"
        ? symbol.line
        : (symbol.patchLine ?? symbol.line);
    const key = `${target.path}:${targetLine}:${caller.path}:${reference.callerLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (
      [...shards, ...checks].some(
        (shard) =>
          shard.files.some(
            (file) =>
              file.path === target.path &&
              (file.patch === target.patch ||
                containsLine(
                  file.patch,
                  targetLine,
                  symbol.change === "deleted" ? "LEFT" : "RIGHT",
                )),
          ) &&
          shard.files.some(
            (file) =>
              file.path === caller.path &&
              (file.patch === caller.patch ||
                containsLine(file.patch, reference.callerLine)),
          ),
      )
    )
      continue;
    if (maxFiles < 2 || maxLines < 2) {
      reasons.capacity++;
      continue;
    }
    const windows = [target, caller].map((file, index) => {
      const pieces = partitionPatch(
        file.patch,
        Math.floor(maxBytes / 2),
        Math.min(80, Math.floor(maxLines / 2)),
        80,
      );
      const line = index === 0 ? targetLine : reference.callerLine;
      const patch =
        index === 1 &&
        pieces.omittedLines === 0 &&
        pieces.patches.length === 1 &&
        pieces.patches[0] === file.patch
          ? file.patch
          : pieces.patches.find((piece) =>
              containsLine(
                piece,
                line,
                index === 0 && symbol.change === "deleted" ? "LEFT" : "RIGHT",
              ),
            );
      return patch ? { ...file, patch } : undefined;
    });
    if (windows.some((file) => file === undefined)) {
      reasons.missingWindow++;
      continue;
    }
    const selected = windows.filter((file) => file !== undefined);
    if (
      selected.reduce((sum, file) => sum + evidenceWindowCount(file.patch), 0) >
      reviewExecutionLimits.shardEvidenceWindows
    ) {
      reasons.evidenceWindows++;
      continue;
    }
    let packed = false;
    for (const check of checks) {
      const combined = combineWindows(
        check,
        selected,
        maxBytes,
        maxLines,
        maxFiles,
        impact,
      );
      if (!combined) continue;
      Object.assign(check, combined);
      packed = true;
      break;
    }
    if (packed) continue;
    if (checks.length >= 8 || shards.length + checks.length >= maxShards) {
      reasons.capacity++;
      continue;
    }
    checks.push({
      id: `contract-check-${checks.length}`,
      index: shards.length + checks.length,
      totalShards: 1,
      ...shardContent(selected),
    });
  }
  return {
    checks,
    omitted: Object.values(reasons).reduce((sum, count) => sum + count, 0),
    reasons,
  };
}
