import {
  reviewContextSchema,
  type ExecutorRequest,
  type ReviewContext,
  type ReviewFileMode,
} from "@holon/contracts";
import {
  classifyPullRequestDiffFile,
  collectChangedLines,
  isNonBinaryPullRequestPatch,
  mapReviewSurface,
  splitPullRequestDiff,
} from "@holon/repository-analysis";

import {
  createReviewScopePolicy,
  serializeReviewScopePolicy,
} from "./review-scope-policy.js";

const maximumFiles = 50;
const maximumDiffBytes = 120_000;
const maximumFileDiffBytes = 60_000;
const maximumChangedLines = 5_000;
const maximumContextBytes = 500_000;

interface ReviewFileCandidate {
  readonly mode: ReviewFileMode;
  readonly patch: string;
  readonly path: string;
}

export interface ReviewArtifacts {
  readonly context: ReviewContext;
  readonly contextBytes: number;
  readonly fileCount: number;
  readonly policy: string;
  readonly serializedContext: string;
}

function prioritizeReviewFiles(
  files: readonly ReviewFileCandidate[],
): readonly ReviewFileCandidate[] {
  const structural = files
    .filter((file) => file.mode === "structural")
    .toSorted((left, right) => left.path.localeCompare(right.path));
  const textual = files
    .filter((file) => file.mode === "textual")
    .toSorted((left, right) => left.path.localeCompare(right.path));
  const prioritized: ReviewFileCandidate[] = [];
  let structuralIndex = 0;
  let textualIndex = 0;
  const takeStructural = () => {
    const file = structural[structuralIndex];
    if (file !== undefined) {
      prioritized.push(file);
      structuralIndex += 1;
    }
  };
  const takeTextual = () => {
    const file = textual[textualIndex];
    if (file !== undefined) {
      prioritized.push(file);
      textualIndex += 1;
    }
  };

  takeStructural();
  takeTextual();
  while (structuralIndex < structural.length || textualIndex < textual.length) {
    for (let index = 0; index < 3; index += 1) takeStructural();
    takeTextual();
  }
  return prioritized;
}

function serializeBoundedContext(context: ReviewContext): {
  readonly context: ReviewContext;
  readonly serialized: string;
} {
  const encode = (changedLineCount: number) => {
    const candidate = reviewContextSchema.parse({
      ...context,
      changedLines: context.changedLines.slice(0, changedLineCount),
      truncated:
        (context.truncated ?? false) ||
        changedLineCount < context.changedLines.length,
    });
    const serialized = JSON.stringify(candidate);
    return {
      bytes: new TextEncoder().encode(serialized).byteLength,
      context: candidate,
      serialized,
    };
  };

  const complete = encode(context.changedLines.length);
  if (complete.bytes <= maximumContextBytes) return complete;

  let lowerBound = 0;
  let upperBound = context.changedLines.length - 1;
  let selected = encode(0);
  if (selected.bytes > maximumContextBytes) {
    throw new RangeError("Review context metadata exceeds the byte limit");
  }
  while (lowerBound <= upperBound) {
    const midpoint = Math.floor((lowerBound + upperBound) / 2);
    const candidate = encode(midpoint);
    if (candidate.bytes <= maximumContextBytes) {
      selected = candidate;
      lowerBound = midpoint + 1;
    } else {
      upperBound = midpoint - 1;
    }
  }
  return selected;
}

export function buildReviewArtifacts(
  request: ExecutorRequest,
): ReviewArtifacts {
  const diffFiles = splitPullRequestDiff(request.canonicalDiff);
  const policy = serializeReviewScopePolicy(createReviewScopePolicy(diffFiles));
  const supportedFiles = prioritizeReviewFiles(
    diffFiles.flatMap((file) => {
      const mode = classifyPullRequestDiffFile(file);
      return mode === undefined || !isNonBinaryPullRequestPatch(file.patch)
        ? []
        : [{ mode, patch: file.patch, path: file.path }];
    }),
  );
  let totalBytes = 0;
  let truncated = supportedFiles.length > maximumFiles;
  const reviewFiles: ReviewFileCandidate[] = [];
  const selectedPaths = new Set<string>();

  for (const file of supportedFiles) {
    if (selectedPaths.has(file.path)) continue;
    if (reviewFiles.length === maximumFiles) {
      truncated = true;
      break;
    }
    const patchBytes = new TextEncoder().encode(file.patch).byteLength;
    if (
      patchBytes > maximumFileDiffBytes ||
      totalBytes + patchBytes > maximumDiffBytes
    ) {
      truncated = true;
      continue;
    }
    selectedPaths.add(file.path);
    totalBytes += patchBytes;
    reviewFiles.push(file);
  }

  const changedLines: Array<{
    line: number;
    path: string;
    side: "RIGHT";
  }> = [];
  for (const file of reviewFiles) {
    const remaining = maximumChangedLines - changedLines.length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const fileLines = collectChangedLines(file.path, file.patch, remaining + 1);
    if (fileLines.length > remaining) truncated = true;
    changedLines.push(...fileLines.slice(0, remaining));
  }

  const surface = mapReviewSurface(
    reviewFiles.filter((file) => file.mode === "structural"),
    50,
  );
  const unboundedContext = reviewContextSchema.parse(
    request.schemaVersion === 2
      ? {
          changedLines,
          files: reviewFiles,
          schemaVersion: 2,
          surface,
          truncated,
        }
      : {
          changedLines,
          diff: reviewFiles.map((file) => file.patch).join(""),
          surface,
          truncated,
        },
  );
  const { context, serialized } = serializeBoundedContext(unboundedContext);
  return {
    context,
    contextBytes: new TextEncoder().encode(serialized).byteLength,
    fileCount: reviewFiles.length,
    policy,
    serializedContext: serialized,
  };
}
