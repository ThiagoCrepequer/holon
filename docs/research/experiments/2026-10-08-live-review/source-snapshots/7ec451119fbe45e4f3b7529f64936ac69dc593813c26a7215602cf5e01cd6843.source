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
  const encoder = new TextEncoder();
  const serialized = JSON.stringify(context);
  if (encoder.encode(serialized).byteLength <= maximumContextBytes) {
    return { context, serialized };
  }

  const emptyContext = {
    ...context,
    changedLines: [],
    truncated: true,
  };
  let bytes = encoder.encode(JSON.stringify(emptyContext)).byteLength;
  if (bytes > maximumContextBytes) {
    throw new RangeError("Review context metadata exceeds the byte limit");
  }

  let changedLineCount = 0;
  for (const changedLine of context.changedLines) {
    const lineBytes = encoder.encode(JSON.stringify(changedLine)).byteLength;
    const nextBytes = bytes + lineBytes + (changedLineCount > 0 ? 1 : 0);
    if (nextBytes > maximumContextBytes) break;
    bytes = nextBytes;
    changedLineCount++;
  }

  const boundedContext = reviewContextSchema.parse({
    ...context,
    changedLines: context.changedLines.slice(0, changedLineCount),
    truncated: true,
  });
  const boundedSerialized = JSON.stringify(boundedContext);
  if (encoder.encode(boundedSerialized).byteLength > maximumContextBytes) {
    throw new RangeError("Review context exceeds the byte limit");
  }
  return { context: boundedContext, serialized: boundedSerialized };
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
