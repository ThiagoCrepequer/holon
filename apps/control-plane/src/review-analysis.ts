import {
  projectConfigurationGuidance,
  RepositoryConfigurationError,
} from "@holon/application";
import {
  aggregateShardReviews,
  createReviewRun,
  verifyFindingsWithCanonicalEvidence,
  type EvidenceRejection,
} from "@holon/application";
import { reviewExecutionLimits } from "@holon/contracts";
import type { RunConfigurationRef } from "@holon/contracts";
import {
  modelReviewOutputSchema,
  reconciledReviewOutputSchema,
  type ReconciledReviewOutput,
  type ReviewJob,
  type RepositoryPolicy,
  type ShardReviewResult,
  type StructuralImpactReport,
} from "@holon/contracts";
import { matchingConfigurationRules } from "@holon/domain";
import {
  computeStableFingerprint,
  computeEvidenceFingerprint,
  createPrKey,
  reconcileFindings,
  type TrackedFinding,
} from "@holon/domain";
import { reviewTimeBudget } from "@holon/model";
import {
  ModelProviderRequestError,
  nonRetryableModelFailureCode,
  preflightReviewPrompt,
} from "@holon/model";
import { buildReviewPlan } from "@holon/repository-analysis";
import { NonRetryableError } from "cloudflare:workflows";

import { resolveReviewGuidance } from "./review-guidance.js";
import type { ReviewServices } from "./review-services.js";
import { buildShardReviewContext } from "./review-shard-context.js";
import { ThinkReviewFailure } from "./think-reviewer.js";

export type { ReconciledReviewOutput } from "@holon/contracts";
export interface ReviewAnalysisExecution<T extends Rpc.Serializable<T>> {
  readonly configuration: RunConfigurationRef;
  runStep<R extends Rpc.Serializable<R>>(
    name: string,
    phase: "preparation" | "analysis",
    callback: () => Promise<R>,
  ): Promise<R>;
  finish(output: ReconciledReviewOutput): Promise<T>;
}

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
  baseline: readonly TrackedFinding[] = [],
  shardIndex?: number,
  deadlineAt?: number,
  effectivePolicy?: RepositoryPolicy,
  configuration?: RunConfigurationRef,
  cancellation?: AbortController,
): Promise<{
  readonly results: readonly ShardReviewResult[];
  readonly anyPromptTruncated: boolean;
}> {
  const results: ShardReviewResult[] = [];
  let anyPromptTruncated = false;
  const identification = services.getProjectIdentification?.();
  for (const shard of plan.shards) {
    if (shardIndex !== undefined && shard.index !== shardIndex) continue;
    const reviewer = services.createShardReviewer(
      shard.index,
      plan.shards.length,
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
    const supplemental = await resolveReviewGuidance(
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
        inputTruncated,
        repositoryGuidance,
        deadlineAt,
      ),
      reviewGuidance: supplemental,
    };
    try {
      const reviewResult = await reviewer.model.review(job, shardContext);
      if (reviewResult.promptTruncated) {
        anyPromptTruncated = true;
      }
      const modelOutput = modelReviewOutputSchema.parse(reviewResult.output);
      const verification = verifyFindingsWithCanonicalEvidence(
        modelOutput.findings,
        shardContext,
      );
      emitEvidenceRejections(
        emit,
        shard.index,
        "finding",
        verification.rejections,
      );
      const verifiedFindings = verification.findings;
      const evidenceRejected =
        verifiedFindings.length !== modelOutput.findings.length;
      if (
        modelOutput.outputLimitations?.length ||
        reviewResult.promptTruncated ||
        evidenceRejected
      )
        emit?.("model.output_limits", {
          shardIndex: shard.index,
          findingsReceived: modelOutput.findings.length,
          evidenceRejectedCount:
            modelOutput.findings.length - verifiedFindings.length,
          limitationCodes: [
            ...(modelOutput.outputLimitations ?? []),
            ...(reviewResult.promptTruncated ? ["input_context_omitted"] : []),
          ].join(","),
          inputContextOmitted: reviewResult.promptTruncated,
          omittedSections: reviewResult.promptOmissions?.join(","),
        });
      results.push({
        findings: modelOutput.findings.filter((finding) =>
          verifiedFindings.includes(finding),
        ),
        resolutions: modelOutput.resolutions,
        isDegraded:
          modelOutput.isDegraded ||
          reviewResult.promptTruncated ||
          evidenceRejected,
        outputLimitations: [
          ...new Set([
            ...(modelOutput.outputLimitations ?? []),
            ...(reviewResult.promptTruncated
              ? ["input_context_omitted" as const]
              : []),
            ...(evidenceRejected ? ["evidence_rejected" as const] : []),
          ]),
        ],
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
      results.push({
        shardId: shard.id,
        shardIndex: shard.index,
        status: "failure",
        findings: [],
        summary: "",
        errorReason:
          failureCode ??
          (error instanceof ThinkReviewFailure ? error.reason : undefined) ??
          (error instanceof ModelProviderRequestError && error.isRetryable
            ? "provider_transient"
            : "provider_permanent"),
      });
    }
  }
  return { anyPromptTruncated, results };
}

export function analyzeReview(
  job: ReviewJob,
  services: ReviewServices,
  emit: EmitReviewEvent,
  effectivePolicy?: RepositoryPolicy,
): Promise<ReconciledReviewOutput>;
export function analyzeReview<T extends Rpc.Serializable<T>>(
  job: ReviewJob,
  services: ReviewServices,
  emit: EmitReviewEvent,
  effectivePolicy: RepositoryPolicy | undefined,
  execution: ReviewAnalysisExecution<T>,
): Promise<T>;
export async function analyzeReview<T extends Rpc.Serializable<T>>(
  job: ReviewJob,
  services: ReviewServices,
  emit: EmitReviewEvent,
  effectivePolicy?: RepositoryPolicy,
  execution?: ReviewAnalysisExecution<T>,
): Promise<T | ReconciledReviewOutput> {
  const runStep = <R extends Rpc.Serializable<R>>(
    name: string,
    phase: "preparation" | "analysis",
    fn: () => Promise<R>,
  ): Promise<R> => (execution ? execution.runStep(name, phase, fn) : fn());
  const loadUncached = async () => {
    await services.ensureContext(2, effectivePolicy);
    const context = await services.loadContext(effectivePolicy);
    const plan = buildReviewPlan(
      context.files.map((file) => ({
        changeType: "modified" as const,
        newPath: file.path,
        oldPath: file.path,
        patch: file.patch,
        path: file.path,
      })),
      { policyExcludedFilesCount: context.waiversCount },
    );
    return {
      context,
      plan: context.truncated
        ? {
            ...plan,
            scopeStatus: "partial_by_policy" as const,
            omissionReasons: [
              ...plan.omissionReasons,
              { code: "executor_budget" as const },
            ],
          }
        : plan,
    };
  };
  // Coalesce simultaneous reads only; later steps still reload and validate the digest.
  let loading: ReturnType<typeof loadUncached> | undefined;
  const load = () =>
    (loading ??= loadUncached().finally(() => {
      loading = undefined;
    }));
  try {
    const runId = createReviewRun(job).id;
    const prKey = createPrKey({
      provider: "github",
      pullRequestNumber: job.envelope.pullRequest.number,
      repositoryId: job.envelope.repository.id,
    });
    const planning = await runStep("plan-review", "preparation", async () => {
      const { context, plan } = await load();
      if (execution !== undefined) {
        const snapshot = await services.ledger.loadRunConfiguration(
          execution.configuration,
        );
        const baseline = await services.ledger.loadPrFindings(prKey);
        const matchedRules = new Set(
          plan.shards.flatMap((shard) =>
            shard.files.flatMap((file) =>
              matchingConfigurationRules(file.path, snapshot.config.pathRules),
            ),
          ),
        );
        const unmatchedPathRules = snapshot.config.pathRules
          .map((rule, index) => (matchedRules.has(rule) ? null : index))
          .filter((index) => index !== null);
        if (unmatchedPathRules.length)
          emit("configuration.unmatched_path_rules", {
            indices: unmatchedPathRules.join(","),
            count: unmatchedPathRules.length,
          });
        for (const shard of plan.shards) {
          const guidance = projectConfigurationGuidance(
            snapshot,
            shard.files.map((file) => file.path),
          );
          emit("configuration.guidance_applied", {
            configDigest: snapshot.configDigest,
            shardIndex: shard.index,
            paths: guidance.scopes.length,
            instructions: guidance.instructions.length,
            bytes: new TextEncoder().encode(JSON.stringify(guidance))
              .byteLength,
          });
          preflightReviewPrompt(
            job,
            buildShardReviewContext(
              shard,
              context.structuralImpact,
              baseline,
              services.getProjectIdentification?.(),
              false,
              guidance,
            ),
          );
        }
      }
      emit("review.coverage_planned", {
        totalEligibleFiles: plan.totalEligibleFiles,
        totalEligibleBytes: plan.totalEligibleBytes,
        totalEligibleLines: plan.totalEligibleLines,
        plannedShards: plan.shards.length,
        concurrency: reviewExecutionLimits.concurrency,
        selectedPatchBytes: plan.shards.reduce(
          (sum, shard) => sum + shard.byteLength,
          0,
        ),
        selectedChangedLines: plan.shards.reduce(
          (sum, shard) => sum + shard.changedLines.length,
          0,
        ),
        selectedFiles: new Set(
          plan.shards.flatMap((shard) => shard.files.map((file) => file.path)),
        ).size,
        omissionReasons: JSON.stringify(plan.omissionReasons),
      });
      const patchBytes = contextBytes(context);
      emit("model.input", {
        changedLineCount: context.changedLines.length,
        estimatedPatchTokens: Math.ceil(patchBytes / 4),
        patchBytes,
        structuralFileCount: context.files.filter(
          (file) => file.mode === "structural",
        ).length,
        surfaceCount: context.surface?.length ?? 0,
        textualFileCount: context.files.filter(
          (file) => file.mode === "textual",
        ).length,
        truncated: context.truncated,
      });
      return {
        shardIds: plan.shards.map((shard) => shard.id),
        planDigest: await planDigest(plan),
        deadlineAt:
          Date.now() +
          Math.max(
            1,
            Math.ceil(plan.shards.length / reviewExecutionLimits.concurrency),
          ) *
            reviewTimeBudget.analysisMs,
      };
    });
    const shardResults: ShardReviewResult[] = [];
    let anyPromptTruncated = false;
    for (
      let offset = 0;
      offset < planning.shardIds.length;
      offset += reviewExecutionLimits.concurrency
    ) {
      const wave = await runStep(
        `analysis-wave-${offset / reviewExecutionLimits.concurrency + 1}`,
        "preparation",
        async () => ({
          deadlineAt: Math.min(
            planning.deadlineAt,
            Date.now() + reviewTimeBudget.analysisMs,
          ),
        }),
      );
      const cancellation = new AbortController();
      // One preparation barrier per live wave. No peer can reconstruct a checkout
      // after another peer has already started using it, including on replay.
      let ready: ReturnType<typeof load> | undefined;
      const prepareWave = () =>
        (ready ??= (async () => {
          cancellation.signal.throwIfAborted();
          if (Date.now() < wave.deadlineAt)
            await services.executor.acquireReviewLease(
              job.runId,
              wave.deadlineAt,
            );
          const loaded = await load();
          if ((await planDigest(loaded.plan)) !== planning.planDigest)
            throw new NonRetryableError("Review plan changed during replay");
          return loaded;
        })());
      const settled = await Promise.allSettled(
        planning.shardIds
          .slice(offset, offset + reviewExecutionLimits.concurrency)
          .map(async (shardId, position) => {
            const index = offset + position;
            return await runStep(
              `analyze-shard-${index + 1}`,
              "analysis",
              async () => {
                cancellation.signal.throwIfAborted();
                const { context, plan } = await prepareWave();
                cancellation.signal.throwIfAborted();
                if (
                  plan.shards[index]?.id !== shardId ||
                  (await planDigest(plan)) !== planning.planDigest
                )
                  throw new NonRetryableError(
                    "Review plan changed during replay",
                  );
                if (Date.now() >= wave.deadlineAt)
                  return {
                    results: [
                      {
                        shardId,
                        shardIndex: index,
                        status: "failure" as const,
                        findings: [],
                        summary: "",
                        errorReason: "analysis_deadline",
                      },
                    ],
                    anyPromptTruncated: false,
                  };
                return reviewShards(
                  job,
                  services,
                  plan,
                  context.structuralImpact,
                  false,
                  emit,
                  await services.ledger.loadPrFindings(prKey),
                  index,
                  wave.deadlineAt,
                  effectivePolicy,
                  execution?.configuration,
                  cancellation,
                );
              },
            ).catch((error: unknown) => {
              cancellation.abort(error);
              throw error;
            });
          }),
      );
      // Join every in-flight shard before terminal cleanup. Infrastructure/state
      // failures retain their cause and cannot become a publishable partial review.
      cancellation.signal.throwIfAborted();
      for (const result of settled)
        if (result.status === "rejected") throw result.reason;
      for (const completed of settled) {
        if (completed.status !== "fulfilled") continue;
        const result = completed.value;
        shardResults.push(...result.results);
        anyPromptTruncated ||= result.anyPromptTruncated;
      }
    }
    if (
      shardResults.length &&
      shardResults.every((result) => result.status === "failure") &&
      shardResults.some((result) => result.errorReason !== "analysis_deadline")
    )
      throw new Error("All review shards failed during model execution");
    return await runStep("analyze-review", "analysis", async () => {
      const { context, plan } = await load();
      if ((await planDigest(plan)) !== planning.planDigest)
        throw new NonRetryableError("Review plan changed during replay");
      const outputPreferences =
        execution === undefined
          ? {
              language: "en" as const,
              detail: "concise" as const,
              maxInlineComments: 40,
            }
          : (
              await services.ledger.loadRunConfiguration(
                execution.configuration,
              )
            ).config.output;

      const verdictPolicy =
        context.verdictStrictness === "block_all_confident_medium"
          ? { mediumSeverityThreshold: 1 }
          : undefined;

      if (plan.scopeStatus === "unsupported" || plan.shards.length === 0) {
        const output: ReconciledReviewOutput = {
          ...aggregateShardReviews(plan, [], {
            verdictPolicy,
            language: outputPreferences.language,
          }),
          output: outputPreferences,
          activeFindings: [],
          contextTruncated: context.truncated,
          effectivePolicyDigest: context.effectivePolicyDigest,
          policySource: context.policySource,
          promptTruncated: context.truncated,
          resolvedFindings: [],
          sourceDigest: context.sourceDigest,
          structuralImpact: context.structuralImpact,
          updatedTrackedFindings: [],
          waiversCount: context.waiversCount,
        };
        return execution ? execution.finish(output) : output;
      }

      const rawAggregated = aggregateShardReviews(plan, shardResults, {
        language: outputPreferences.language,
        verdictPolicy,
      });
      const currentWithFingerprints = await Promise.all(
        rawAggregated.findings.map(async (finding) => ({
          ...finding,
          evidenceFingerprint: await computeEvidenceFingerprint(
            finding.location.path,
            finding.evidence,
          ),
          fingerprint: await computeStableFingerprint({
            diagnostic: finding.diagnostic,
            excerpt: finding.evidence[0]?.excerpt ?? "",
            path: finding.location.path,
          }),
        })),
      );
      const baseline = await services.ledger.loadPrFindings(prKey);
      const confirmedResolvedFingerprints = (
        await Promise.all(
          shardResults
            .filter(
              (result) =>
                result.status === "success" && result.isDegraded !== true,
            )
            .flatMap((result) =>
              (result.resolutions ?? []).map(
                async (resolution, resolutionIndex) => {
                  const previous = baseline.find(
                    (f) =>
                      f.fingerprint === resolution.fingerprint &&
                      f.filePath === resolution.location.path,
                  );
                  const shard = plan.shards.find(
                    (candidateShard) => candidateShard.id === result.shardId,
                  );
                  if (
                    !previous ||
                    !shard?.files.some(
                      (file) => file.path === previous.filePath,
                    ) ||
                    resolution.confidence < 0.9
                  )
                    return [];
                  const verified = verifyFindingsWithCanonicalEvidence(
                    [{ ...resolution, severity: previous.severity }],
                    context,
                  );
                  emitEvidenceRejections(
                    emit,
                    result.shardIndex,
                    "resolution",
                    verified.rejections.map((rejection) => ({
                      ...rejection,
                      findingIndex: resolutionIndex,
                    })),
                  );
                  if (!verified.findings.length) return [];
                  const evidenceFingerprint = await computeEvidenceFingerprint(
                    resolution.location.path,
                    resolution.evidence,
                  );
                  return previous.evidenceFingerprint === evidenceFingerprint
                    ? []
                    : [resolution.fingerprint];
                },
              ),
            ),
        )
      ).flat();
      const pullRequestFiles = plan.shards.flatMap((shard) =>
        shard.files.map((file) => file.path),
      );
      const reconciled = reconcileFindings({
        baselineFindings: baseline,
        coverage: {
          confirmedResolvedFingerprints,
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
        language: outputPreferences.language,
        canonicalFindings: reconciled.activeFindings,
        publication: {
          findings: reconciled.activeFindings,
          output: outputPreferences,
        },
        reconciliation: reconciled.summary,
        structuralImpact: context.structuralImpact,
        verdictPolicy,
      });
      const output = reconciledReviewOutputSchema.parse({
        ...finalAggregated,
        output: outputPreferences,
        analysisIsDegraded: rawAggregated.isDegraded === true,
        verdictPolicy,
        activeFindings: reconciled.activeFindings,
        effectivePolicyDigest: context.effectivePolicyDigest,
        policySource: context.policySource,
        resolvedFindings: reconciled.resolvedFindings,
        sourceDigest: context.sourceDigest,
        structuralImpact: context.structuralImpact,
        updatedTrackedFindings: reconciled.updatedTrackedFindings,
        waiversCount: context.waiversCount,
        contextTruncated: context.truncated,
        promptTruncated: anyPromptTruncated || context.truncated,
      });
      return execution ? execution.finish(output) : output;
    });
  } catch (error) {
    if (error instanceof RepositoryConfigurationError)
      throw new NonRetryableError(`HOLON_REPOSITORY_CONFIG:${error.code}`);
    const failureCode = nonRetryableModelFailureCode(error);
    if (failureCode !== undefined) {
      throw new NonRetryableError(`HOLON_MODEL_NON_RETRYABLE:${failureCode}`);
    }
    throw error;
  }
}

async function planDigest(
  plan: ReturnType<typeof buildReviewPlan>,
): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(plan)),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Logging is advisory and must not change evidence acceptance or retries. */
function emitEvidenceRejections(
  emit: EmitReviewEvent | undefined,
  shardIndex: number,
  candidateKind: "finding" | "resolution",
  rejections: readonly EvidenceRejection[],
): void {
  for (const rejection of rejections) {
    try {
      emit?.(
        "model.evidence_rejected",
        {
          severity: "warning",
          shardIndex,
          candidateKind,
          ...rejection,
        },
        `${shardIndex}:${candidateKind}:${rejection.findingIndex}`,
      );
    } catch {
      // Keep the canonical verification result even if the log sink fails.
    }
  }
}
