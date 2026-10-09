import {
  projectRepositoryMemory,
  projectConfigurationGuidance,
  createCanonicalEvidenceVerifier,
} from "@holon/application";
import {
  modelReviewOutputSchema,
  type ReviewJob,
  type ReviewShard,
  type StructuralImpactReport,
  type ShardReviewResult,
  type RunConfigurationRef,
  type MemorySnapshot,
} from "@holon/contracts";
import type { TrackedFinding } from "@holon/domain";
import {
  ModelProviderRequestError,
  nonRetryableModelFailureCode,
} from "@holon/model";

import {
  emitDiagnostic,
  emitEvidenceRejections,
  type EmitReviewEvent,
} from "./review-diagnostics.js";
import type { createReviewGuidanceResolver } from "./review-guidance.js";
import type { ReviewServices } from "./review-services.js";
import { buildShardReviewContext } from "./review-shard-context.js";
import { ThinkReviewFailure } from "./think-reviewer.js";

interface ShardExecutionContext {
  readonly job: ReviewJob;
  readonly services: Pick<
    ReviewServices,
    "createShardReviewer" | "getProjectIdentification"
  > & {
    readonly ledger: Pick<ReviewServices["ledger"], "loadRunConfiguration">;
  };
  readonly shard: ReviewShard;
  readonly shardCount: number;
  readonly structuralImpact?: StructuralImpactReport | undefined;
  readonly emit?: EmitReviewEvent | undefined;
  readonly baseline: readonly TrackedFinding[];
  readonly deadlineAt: number;
  readonly configuration?: RunConfigurationRef | undefined;
  readonly cancellation: AbortController;
  readonly memory?: MemorySnapshot | undefined;
  readonly resolveGuidance: ReturnType<typeof createReviewGuidanceResolver>;
}

export async function reviewShard({
  job,
  services,
  shard,
  shardCount,
  structuralImpact,
  emit,
  baseline,
  deadlineAt,
  configuration,
  cancellation,
  memory,
  resolveGuidance,
}: ShardExecutionContext): Promise<{
  readonly results: readonly ShardReviewResult[];
  readonly anyPromptTruncated: boolean;
}> {
  const results: ShardReviewResult[] = [];
  let anyPromptTruncated = false;
  const identification = services.getProjectIdentification?.();
  const reviewer = services.createShardReviewer(
    shard.index,
    shardCount,
    cancellation,
  );
  const snapshot =
    configuration === undefined
      ? undefined
      : await services.ledger.loadRunConfiguration(configuration);
  const repositoryGuidance =
    snapshot === undefined
      ? undefined
      : projectConfigurationGuidance(
          snapshot,
          shard.files.map((file) => file.path),
        );
  const supplemental = await resolveGuidance(
    snapshot?.config.documentation,
    shard.files.map((file) => file.path),
    identification,
  );
  const shardContext = {
    ...buildShardReviewContext(
      shard,
      structuralImpact,
      baseline,
      identification,
      false,
      repositoryGuidance,
      deadlineAt,
    ),
    reviewGuidance: supplemental,
    memory: memory
      ? projectRepositoryMemory(
          memory,
          shard.files.map((file) => file.path),
        )
      : undefined,
  };
  try {
    const reviewResult = await reviewer.model.review(job, shardContext);
    if (reviewResult.promptTruncated) {
      anyPromptTruncated = true;
    }
    const modelOutput = modelReviewOutputSchema.parse(reviewResult.output);
    const evidenceVerifier = createCanonicalEvidenceVerifier(shardContext);
    const verification = evidenceVerifier.verify(modelOutput.findings);
    emitEvidenceRejections(
      emit,
      shard.index,
      "finding",
      verification.rejections,
    );
    const verifiedFindings = verification.findings;
    const investigations = (modelOutput.investigations ?? []).filter(
      (item) =>
        evidenceVerifier.verify([
          {
            confidence: 1,
            diagnostic: item.summary,
            severity: "low",
            location: { path: item.path, line: item.line, side: "RIGHT" },
            evidence: [
              {
                path: item.path,
                startLine: item.line,
                excerpt: item.excerpt,
                reason: "Investigation observation",
              },
            ],
          },
        ]).findings.length === 1,
    );

    const evidenceRejected =
      verifiedFindings.length !== modelOutput.findings.length;
    if (
      modelOutput.outputLimitations?.length ||
      reviewResult.promptTruncated ||
      evidenceRejected
    )
      emitDiagnostic(
        emit,
        "model.output_limits",
        {
          shardIndex: shard.index,
          findingsReceived: modelOutput.findings.length,
          evidenceRejectedCount:
            modelOutput.findings.length - verifiedFindings.length,
          evidenceRejectionStage: "publication",
          limitationCodes: [
            ...(modelOutput.outputLimitations ?? []),
            ...(reviewResult.promptTruncated ? ["input_context_omitted"] : []),
          ].join(","),
          inputContextOmitted: reviewResult.promptTruncated,
          omittedSections: reviewResult.promptOmissions?.join(","),
        },
        String(shard.index),
      );
    const limitations = [
      ...new Set([
        ...(modelOutput.outputLimitations ?? []),
        ...(reviewResult.promptTruncated
          ? ["input_context_omitted" as const]
          : []),
        ...(evidenceRejected ? ["evidence_rejected" as const] : []),
      ]),
    ];
    for (const reason of limitations)
      emitDiagnostic(
        emit,
        "review.shard_partial",
        {
          severity: "warning",
          shardIndex: shard.index,
          reason,
          findingsReceived: modelOutput.findings.length,
          findingsVerified: verifiedFindings.length,
        },
        `${shard.index}:${reason}`,
      );
    if (modelOutput.isDegraded && limitations.length === 0)
      emitDiagnostic(
        emit,
        "review.shard_partial",
        {
          severity: "warning",
          shardIndex: shard.index,
          reason: "model_degraded",
        },
        `${shard.index}:model_degraded`,
      );
    results.push({
      findings: modelOutput.findings.filter(
        (_finding, index) =>
          !verification.rejections.some(
            (rejection) => rejection.findingIndex === index,
          ),
      ),
      resolutions: modelOutput.resolutions,
      investigations,
      isDegraded:
        modelOutput.isDegraded ||
        reviewResult.promptTruncated ||
        evidenceRejected,
      outputLimitations: limitations,
      shardId: shard.id,
      shardIndex: shard.index,
      status: "success",
      summary: modelOutput.summary,
    });
  } catch (error) {
    const failureCode = nonRetryableModelFailureCode(error);
    if (
      failureCode === undefined &&
      !(error instanceof ModelProviderRequestError) &&
      !(error instanceof ThinkReviewFailure)
    )
      throw error;
    const reason =
      failureCode ??
      (error instanceof ThinkReviewFailure
        ? error.reason
        : error instanceof ModelProviderRequestError && error.isRetryable
          ? "provider_transient"
          : "provider_permanent");
    emitDiagnostic(
      emit,
      "review.shard_failed",
      {
        severity: "error",
        shardIndex: shard.index,
        reason,
        ...(error instanceof ModelProviderRequestError
          ? { statusCode: error.statusCode, retryable: error.isRetryable }
          : {}),
      },
      `${shard.index}:${reason}`,
    );
    results.push({
      shardId: shard.id,
      shardIndex: shard.index,
      status: "failure",
      findings: [],
      summary: "",
      errorReason: reason,
    });
  }
  return { anyPromptTruncated, results };
}
