import { aggregateShardReviews, createReviewRun } from "@holon/application";
import {
  modelReviewOutputSchema,
  type AggregatedReviewResult,
  type ReviewJob,
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
  readonly resolvedFindings: readonly TrackedFinding[];
  readonly structuralImpact?: StructuralImpactReport | undefined;
  readonly updatedTrackedFindings: readonly TrackedFinding[];
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
): Promise<readonly ShardReviewResult[]> {
  const results: ShardReviewResult[] = [];
  for (const shard of plan.shards) {
    const shardContext = {
      changedLines: shard.changedLines,
      files: shard.files,
      schemaVersion: 2 as const,
      structuralImpact,
      surface: shard.surface,
      truncated: shard.totalShards > 1,
    };
    try {
      const reviewResult = await services.model.review(job, shardContext);
      const modelOutput = modelReviewOutputSchema.parse(reviewResult.output);
      results.push({
        findings: modelOutput.findings,
        isDegraded: modelOutput.isDegraded,
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
): Promise<ReconciledReviewOutput> {
  try {
    const runId = createReviewRun(job).id;
    await services.ensureContext(2);
    const context = await services.loadContext();
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

    const plan = buildReviewPlan(
      context.files.map((file) => ({
        changeType: "modified" as const,
        newPath: file.path,
        oldPath: file.path,
        patch: file.patch,
        path: file.path,
      })),
    );
    if (plan.scopeStatus === "unsupported" || plan.shards.length === 0) {
      return {
        ...aggregateShardReviews(plan, []),
        activeFindings: [],
        resolvedFindings: [],
        structuralImpact: context.structuralImpact,
        updatedTrackedFindings: [],
      };
    }

    const shardResults = await reviewShards(
      job,
      services,
      plan,
      context.structuralImpact,
    );

    const successfulSummaries = shardResults
      .filter((r) => r.status === "success" && r.summary.trim().length > 0)
      .map((r) => r.summary.trim());

    let unifiedSummary: string | undefined;
    if (
      successfulSummaries.length > 1 &&
      typeof services.model.synthesizeReviewSummary === "function"
    ) {
      try {
        unifiedSummary = await services.model.synthesizeReviewSummary(job, {
          shardSummaries: successfulSummaries,
        });
      } catch {
        unifiedSummary = undefined;
      }
    }

    const rawAggregated = aggregateShardReviews(plan, shardResults, {
      additionalFindings: context.structuralImpact?.deterministicFindings ?? [],
      unifiedSummary,
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
    const finalAggregated = aggregateShardReviews(plan, shardResults, {
      canonicalFindings: reconciled.activeFindings,
      reconciliation: reconciled.summary,
      structuralImpact: context.structuralImpact,
    });
    return {
      ...finalAggregated,
      activeFindings: reconciled.activeFindings,
      resolvedFindings: reconciled.resolvedFindings,
      structuralImpact: context.structuralImpact,
      updatedTrackedFindings: reconciled.updatedTrackedFindings,
    };
  } catch (error) {
    const failureCode = nonRetryableModelFailureCode(error);
    if (failureCode !== undefined) {
      throw new NonRetryableError(`HOLON_MODEL_NON_RETRYABLE:${failureCode}`);
    }
    throw error;
  }
}
