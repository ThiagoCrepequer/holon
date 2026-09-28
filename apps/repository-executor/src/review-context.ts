import {
  reviewContextSchema,
  reviewExecutionLimits,
  type ExecutorRequest,
  type ReviewContext,
  type ReviewPlan,
} from "@holon/contracts";
import {
  analyzeStructuralImpact,
  buildReviewPlan,
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

const maximumChangedLines = reviewExecutionLimits.contextLines;
const maximumContextBytes = reviewExecutionLimits.contextBytes;

export interface ReviewArtifacts {
  readonly context: ReviewContext;
  readonly contextBytes: number;
  readonly fileCount: number;
  readonly plan: ReviewPlan;
  readonly policy: string;
  readonly serializedContext: string;
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
  repositoryFiles: readonly {
    readonly content: string;
    readonly path: string;
  }[],
  repositoryScanTruncated = false,
): ReviewArtifacts {
  const diffFiles = splitPullRequestDiff(request.canonicalDiff);
  const additionalExcludes = request.effectivePolicy.additionalExcludes;
  const policy = serializeReviewScopePolicy(
    createReviewScopePolicy(diffFiles, additionalExcludes),
  );

  const plan = buildReviewPlan(diffFiles, { additionalExcludes });
  const waiversCount = diffFiles.filter(
    (file) =>
      classifyPullRequestDiffFile(file) !== undefined &&
      isNonBinaryPullRequestPatch(file.patch) &&
      classifyPullRequestDiffFile(file, additionalExcludes) === undefined,
  ).length;
  const reviewFiles = diffFiles
    .flatMap((file) => {
      const mode = classifyPullRequestDiffFile(file, additionalExcludes);
      return mode && isNonBinaryPullRequestPatch(file.patch)
        ? [{ mode, path: file.path, patch: file.patch }]
        : [];
    })
    .slice(0, reviewExecutionLimits.contextFiles);
  let truncated =
    diffFiles.filter(
      (file) =>
        classifyPullRequestDiffFile(file, additionalExcludes) !== undefined,
    ).length > reviewFiles.length;

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
  const structuralImpact = analyzeStructuralImpact({
    changedFiles: reviewFiles,
    repositoryFiles,
    repositoryScanTruncated,
  });

  const unboundedContext = reviewContextSchema.parse({
    changedLines,
    effectivePolicyDigest: request.effectivePolicy.effectivePolicyDigest,
    files: reviewFiles,
    policySource: request.effectivePolicy.source,
    sourceDigest: request.effectivePolicy.sourceDigest,
    structuralImpact,
    surface,
    truncated,
    verdictStrictness: request.effectivePolicy.verdictStrictness,
    waiversCount,
  });
  const { context, serialized } = serializeBoundedContext(unboundedContext);
  return {
    context,
    contextBytes: new TextEncoder().encode(serialized).byteLength,
    fileCount: reviewFiles.length,
    plan,
    policy,
    serializedContext: serialized,
  };
}
