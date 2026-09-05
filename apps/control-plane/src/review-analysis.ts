import { aggregateShardReviews, createReviewRun } from "@holon/application";
import {
  modelReviewOutputSchema,
  type AggregatedReviewResult,
  type ReviewJob,
  type RepositoryPolicy,
  type RepositoryPolicySource,
  type ShardReviewResult,
  type StructuralImpactReport,
} from "@holon/contracts";
import {
  computeStableFingerprint,
  createPrKey,
  reconcileFindings,
  type ReconciledFinding,
  type TrackedFinding,
} from "@holon/domain";
import { nonRetryableModelFailureCode } from "@holon/model";
import { buildReviewPlan } from "@holon/repository-analysis";
import { NonRetryableError } from "cloudflare:workflows";

import { errorKind } from "./observability.js";
import type { ReviewServices } from "./review-services.js";

export type ReconciledReviewOutput = AggregatedReviewResult & {
  readonly activeFindings: readonly ReconciledFinding[];
  readonly effectivePolicyDigest?: string | undefined;
  readonly policySource?: RepositoryPolicySource | undefined;
  readonly resolvedFindings: readonly TrackedFinding[];
  readonly sourceDigest?: string | null | undefined;
  readonly structuralImpact?: StructuralImpactReport | undefined;
  readonly updatedTrackedFindings: readonly TrackedFinding[];
  readonly waiversCount?: number | undefined;
};

type EmitReviewEvent = (
  event: string,
  fields?: Readonly<Record<string, boolean | number | string | undefined>>,
  suffix?: number | string,
) => void;

function contextBytes(context: {
  readonly files: readonly { readonly patch: string }[];
}): number {
  return context.files.reduce(
    (total, file) => total + new TextEncoder().encode(file.patch).byteLength,
    0,
  );
}

function reviewedFiles(
  plan: ReturnType<typeof buildReviewPlan>,
  shardResults: readonly ShardReviewResult[],
): readonly string[] {
  const successfulShardIds = new Set(
    shardResults
      .filter(
        (result) => result.status === "success" && result.isDegraded !== true,
      )
      .map((result) => result.shardId),
  );
  return plan.shards
    .filter((shard) => successfulShardIds.has(shard.id))
    .flatMap((shard) => shard.files.map((file) => file.path));
}

async function reviewShards(
  job: ReviewJob,
  services: ReviewServices,
  plan: ReturnType<typeof buildReviewPlan>,
  structuralImpact: StructuralImpactReport | undefined,
  inputTruncated = false,
  emit?: EmitReviewEvent,
): Promise<readonly ShardReviewResult[]> {
  const results: ShardReviewResult[] = [];
  const identification = services.getProjectIdentification?.();
  for (const shard of plan.shards) {
    const shardContext = {
      projectIdentification: identification
        ? {
            ...identification,
            projects: identification.projects.filter((project) =>
              shard.files.some(
                (file) =>
                  (project.root === "." ||
                    file.path.startsWith(project.root + "/")) &&
                  !identification.projects.some(
                    (other) =>
                      other.root !== project.root &&
                      (project.root === "." ||
                        other.root.startsWith(project.root + "/")) &&
                      file.path.startsWith(other.root + "/"),
                  ),
              ),
            ),
          }
        : undefined,
      changedLines: shard.changedLines,
      files: shard.files,
      schemaVersion: 2 as const,
      structuralImpact: structuralImpact
        ? {
            ...structuralImpact,
            changedSymbols: structuralImpact.changedSymbols.filter((signal) =>
              shard.files.some((file) => file.path === signal.path),
            ),
            contractBreaks: structuralImpact.contractBreaks.filter((signal) =>
              shard.files.some((file) => file.path === signal.path),
            ),
            downstreamReferences: structuralImpact.downstreamReferences.filter(
              (signal) =>
                shard.files.some((file) => file.path === signal.targetPath),
            ),
            testGaps: structuralImpact.testGaps.filter((signal) =>
              shard.files.some((file) => file.path === signal.sourcePath),
            ),
            securitySurfaces: structuralImpact.securitySurfaces.filter(
              (signal) => shard.files.some((file) => file.path === signal.path),
            ),
          }
        : undefined,
      surface: shard.surface,
      truncated: inputTruncated,
    };
    try {
      const reviewResult = await services.model.review(job, shardContext);
      const modelOutput = modelReviewOutputSchema.parse(reviewResult.output);
      if (modelOutput.outputLimitations?.length || reviewResult.promptTruncated)
        emit?.("model.output_limits", {
          shardIndex: shard.index,
          limitationCodes: (modelOutput.outputLimitations ?? []).join(","),
          inputContextOmitted: reviewResult.promptTruncated,
        });
      results.push({
        findings: modelOutput.findings,
        isDegraded: modelOutput.isDegraded || reviewResult.promptTruncated,
        outputLimitations: [
          ...new Set([
            ...(modelOutput.outputLimitations ?? []),
            ...(reviewResult.promptTruncated
              ? ["input_context_omitted" as const]
              : []),
          ]),
        ],
        shardId: shard.id,
        shardIndex: shard.index,
        status: "success",
        summary: modelOutput.summary,
      });
    } catch (error) {
      if (plan.shards.length === 1) throw error;
      const failureCode = nonRetryableModelFailureCode(error);
      results.push({
        errorReason:
          failureCode === undefined
            ? `model_${errorKind(error)}`
            : `model_${failureCode}`,
        findings: [],
        shardId: shard.id,
        shardIndex: shard.index,
        status: "failure",
        summary: "",
      });
    }
  }
  if (
    results.length > 0 &&
    results.every((result) => result.status === "failure")
  ) {
    throw new Error("All review shards failed during model execution");
  }
  return results;
}

export async function analyzeReview(
  job: ReviewJob,
  services: ReviewServices,
  emit: EmitReviewEvent,
  effectivePolicy?: RepositoryPolicy,
): Promise<ReconciledReviewOutput> {
  try {
    const runId = createReviewRun(job).id;
    await services.ensureContext(2, effectivePolicy);
    const context = await services.loadContext(effectivePolicy);
    const patchBytes = contextBytes(context);
    emit("model.input", {
      changedLineCount: context.changedLines.length,
      estimatedPatchTokens: Math.ceil(patchBytes / 4),
      patchBytes,
      structuralFileCount: context.files.filter(
        (file) => file.mode === "structural",
      ).length,
      surfaceCount: context.surface?.length ?? 0,
      textualFileCount: context.files.filter((file) => file.mode === "textual")
        .length,
      truncated: context.truncated,
    });

    const verdictPolicy =
      context.verdictStrictness === "block_all_confident_medium"
        ? { mediumSeverityThreshold: 1 }
        : undefined;

    const policyExcludedFilesCount = context.waiversCount;
    const plan = buildReviewPlan(
      context.files.map((file) => ({
        changeType: "modified" as const,
        newPath: file.path,
        oldPath: file.path,
        patch: file.patch,
        path: file.path,
      })),
      { policyExcludedFilesCount },
    );
    if (plan.scopeStatus === "unsupported" || plan.shards.length === 0) {
      return {
        ...aggregateShardReviews(plan, [], { verdictPolicy }),
        activeFindings: [],
        effectivePolicyDigest:
          context.schemaVersion === 3
            ? context.effectivePolicyDigest
            : undefined,
        policySource: context.policySource,
        resolvedFindings: [],
        sourceDigest: context.sourceDigest,
        structuralImpact: context.structuralImpact,
        updatedTrackedFindings: [],
        waiversCount: context.waiversCount,
      };
    }

    const shardResults = await reviewShards(
      job,
      services,
      plan,
      context.structuralImpact,
      context.truncated || plan.scopeStatus === "partial_by_policy",
      emit,
    );

    const successfulSummaries = shardResults
      .filter((r) => r.status === "success" && r.summary.trim().length > 0)
      .map((r) => r.summary.trim());

    const rawAggregated = aggregateShardReviews(plan, shardResults, {
      verdictPolicy,
    });
    const currentWithFingerprints = await Promise.all(
      rawAggregated.findings.map(async (finding) => ({
        ...finding,
        fingerprint: await computeStableFingerprint({
          diagnostic: finding.diagnostic,
          excerpt: finding.evidence[0]?.excerpt ?? "",
          path: finding.location.path,
        }),
      })),
    );
    const prKey = createPrKey({
      provider: "github",
      pullRequestNumber: job.envelope.pullRequest.number,
      repositoryId: job.envelope.repository.id,
    });
    const baseline = await services.ledger.loadPrFindings(prKey);
    const pullRequestFiles = plan.shards.flatMap((shard) =>
      shard.files.map((file) => file.path),
    );
    const reconciled = reconcileFindings({
      baselineFindings: baseline,
      coverage: {
        isComplete:
          rawAggregated.scopeStatus === "complete" &&
          rawAggregated.isDegraded !== true,
        pullRequestFiles,
        reviewedFiles: reviewedFiles(plan, shardResults),
      },
      currentFindings: currentWithFingerprints,
      currentHeadSha: job.envelope.pullRequest.headSha,
      currentRunId: runId,
      prKey,
    });
    let unifiedSummary: string | undefined;
    if (
      successfulSummaries.length > 1 &&
      typeof services.model.synthesizeReviewSummary === "function"
    ) {
      try {
        unifiedSummary = await services.model.synthesizeReviewSummary(job, {
          shardSummaries: successfulSummaries,
          verifiedFindings: reconciled.activeFindings.map((finding) => ({
            diagnostic: finding.diagnostic,
            severity: finding.severity,
            path: finding.location.path,
          })),
        });
      } catch {
        unifiedSummary =
          "Narrative synthesis was unavailable. Refer to the verified findings and coverage in this review.";
      }
    }

    const finalAggregated = aggregateShardReviews(plan, shardResults, {
      canonicalFindings: reconciled.activeFindings,
      unifiedSummary,
      reconciliation: reconciled.summary,
      structuralImpact: context.structuralImpact,
      verdictPolicy,
    });
    return {
      ...finalAggregated,
      activeFindings: reconciled.activeFindings,
      effectivePolicyDigest: context.effectivePolicyDigest,
      policySource: context.policySource,
      resolvedFindings: reconciled.resolvedFindings,
      sourceDigest: context.sourceDigest,
      structuralImpact: context.structuralImpact,
      updatedTrackedFindings: reconciled.updatedTrackedFindings,
      waiversCount: context.waiversCount,
    };
  } catch (error) {
    const failureCode = nonRetryableModelFailureCode(error);
    if (failureCode !== undefined) {
      throw new NonRetryableError(`HOLON_MODEL_NON_RETRYABLE:${failureCode}`);
    }
    throw error;
  }
}
