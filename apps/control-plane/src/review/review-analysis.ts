import { projectRepositoryMemory } from "@holon/application";
import {
  projectConfigurationGuidance,
  RepositoryConfigurationError,
} from "@holon/application";
import {
  aggregateShardReviews,
  createReviewRun,
  createCanonicalEvidenceVerifier,
  planReviewLanes,
} from "@holon/application";
import type { MemorySnapshot } from "@holon/contracts";
import {
  createReviewBudgetPlan,
  reviewExecutionLimits,
  reviewGenerationCallsPerShard,
} from "@holon/contracts";
import type { RunConfigurationRef } from "@holon/contracts";
import {
  reconciledReviewOutputSchema,
  type ReconciledReviewOutput,
  type ReviewJob,
  type RepositoryPolicy,
  type ShardReviewResult,
  type ModelGenerationStopReason,
} from "@holon/contracts";
import { matchingConfigurationRules } from "@holon/domain";
import {
  computeStableFingerprint,
  computeEvidenceFingerprint,
  createPrKey,
  reconcileFindings,
} from "@holon/domain";
import { reviewTimeBudget } from "@holon/model";
import {
  nonRetryableModelFailureCode,
  preflightReviewPrompt,
} from "@holon/model";
import { buildReviewPlan } from "@holon/repository-analysis";
import { NonRetryableError } from "cloudflare:workflows";

import { errorKind } from "../observability.js";
import {
  emitDiagnostic,
  emitEvidenceRejections,
  type EmitReviewEvent,
} from "./review-diagnostics.js";
import { createReviewGuidanceResolver } from "./review-guidance.js";
import type { ReviewServices } from "./review-services.js";
import { buildShardReviewContext } from "./review-shard-context.js";
import { reviewShard } from "./review-shard-execution.js";

export type { ReconciledReviewOutput } from "@holon/contracts";
type ReviewAnalysisServices = Pick<
  ReviewServices,
  | "createShardReviewer"
  | "ensureContext"
  | "getProjectIdentification"
  | "loadContext"
> & {
  readonly executor: Pick<ReviewServices["executor"], "acquireReviewLease">;
  readonly ledger: Pick<
    ReviewServices["ledger"],
    | "loadPrFindings"
    | "loadRunConfiguration"
    | "loadModelGenerationStop"
    | "configureReviewBudget"
    | "completeReviewBudgetShard"
  >;
};

export interface ReviewAnalysisExecution<T extends Rpc.Serializable<T>> {
  readonly configuration: RunConfigurationRef;
  readonly memory?: MemorySnapshot | undefined;
  runStep<R extends Rpc.Serializable<R>>(
    name: string,
    phase: "preparation" | "analysis",
    callback: () => Promise<R>,
  ): Promise<R>;
  finish(output: ReconciledReviewOutput): Promise<T>;
}

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
  const paths = new Set(
    plan.shards.flatMap((shard) => shard.files.map((file) => file.path)),
  );
  return [...paths].filter((path) =>
    plan.shards
      .filter((shard) => shard.files.some((file) => file.path === path))
      .every((shard) => successfulShardIds.has(shard.id)),
  );
}

export function analyzeReview(
  job: ReviewJob,
  services: ReviewAnalysisServices,
  emit: EmitReviewEvent,
  effectivePolicy?: RepositoryPolicy,
): Promise<ReconciledReviewOutput>;
export function analyzeReview<T extends Rpc.Serializable<T>>(
  job: ReviewJob,
  services: ReviewAnalysisServices,
  emit: EmitReviewEvent,
  effectivePolicy: RepositoryPolicy | undefined,
  execution: ReviewAnalysisExecution<T>,
): Promise<T>;
export async function analyzeReview<T extends Rpc.Serializable<T>>(
  job: ReviewJob,
  services: ReviewAnalysisServices,
  emitSink: EmitReviewEvent,
  effectivePolicy?: RepositoryPolicy,
  execution?: ReviewAnalysisExecution<T>,
): Promise<T | ReconciledReviewOutput> {
  const emit: EmitReviewEvent = (...args) => {
    try {
      emitSink(...args);
    } catch {
      // All diagnostics are advisory, including preparation and planning.
    }
  };
  const resolveGuidance = createReviewGuidanceResolver();
  const runStep = <R extends Rpc.Serializable<R>>(
    name: string,
    phase: "preparation" | "analysis",
    fn: () => Promise<R>,
  ): Promise<R> => {
    const timed = async () => {
      const startedAt = Date.now();
      let outcome = "failed";
      try {
        const value = await fn();
        outcome = "completed";
        return value;
      } finally {
        emitDiagnostic(
          emit,
          "review.phase_finished",
          {
            phase,
            step: name,
            outcome,
            durationMs: Date.now() - startedAt,
          },
          name,
        );
      }
    };
    return execution ? execution.runStep(name, phase, timed) : timed();
  };
  const loadUncached = async () => {
    const startedAt = Date.now();
    const context = await services.loadContext(effectivePolicy);
    const plan = buildReviewPlan(
      context.files.map((file) => ({
        changeType: "modified" as const,
        newPath: file.path,
        oldPath: file.path,
        patch: file.patch,
        path: file.path,
      })),
      {
        policyExcludedFilesCount: context.waiversCount,
        structuralImpact: context.structuralImpact,
      },
    );
    const effectivePlan = context.truncated
      ? {
          ...plan,
          scopeStatus: "partial_by_policy" as const,
          omissionReasons: [
            ...plan.omissionReasons,
            { code: "executor_budget" as const },
          ],
        }
      : plan;
    const digest = await planDigest(effectivePlan);
    emitDiagnostic(emit, "review.analysis_context_loaded", {
      files: context.files.length,
      shards: effectivePlan.shards.length,
      patchBytes: contextBytes(context),
      durationMs: Date.now() - startedAt,
    });
    return { context, plan: effectivePlan, digest };
  };
  // Only this invocation owns the snapshot. Replay starts fresh; reconstruction
  // invalidates it before any shard can use the new canonical checkout.
  let contextSnapshot: ReturnType<typeof loadUncached> | undefined;
  const load = async () => {
    if (await services.ensureContext(2, effectivePolicy))
      contextSnapshot = undefined;
    if (!contextSnapshot)
      contextSnapshot = loadUncached().catch((error: unknown) => {
        contextSnapshot = undefined;
        throw error;
      });
    return contextSnapshot;
  };
  try {
    const runId = createReviewRun(job).id;
    const prKey = createPrKey({
      provider: "github",
      pullRequestNumber: job.envelope.pullRequest.number,
      repositoryId: job.envelope.repository.id,
    });
    const planning = await runStep("plan-review", "preparation", async () => {
      const { context, plan, digest } = await load();
      let initialPromptBytes = 0;
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
          const initialPrompt = preflightReviewPrompt(job, {
            ...buildShardReviewContext(
              shard,
              context.structuralImpact,
              baseline,
              services.getProjectIdentification?.(),
              false,
              guidance,
            ),
            memory: execution.memory
              ? projectRepositoryMemory(
                  execution.memory,
                  shard.files.map((file) => file.path),
                )
              : undefined,
          });
          initialPromptBytes += initialPrompt.initialRequestBytes;
        }
      }
      if (plan.shards.length) {
        if (!initialPromptBytes)
          initialPromptBytes = plan.shards.reduce(
            (sum, shard) =>
              sum +
              preflightReviewPrompt(
                job,
                buildShardReviewContext(
                  shard,
                  context.structuralImpact,
                  [],
                  services.getProjectIdentification?.(),
                  false,
                ),
              ).initialRequestBytes,
            0,
          );
        // Seven turns with an allowance for accumulating history; actual input is
        // charged on every inference, so this estimate cannot bypass the ceiling.
        const weights = plan.shards.map((shard) => {
          const paths = new Set(shard.files.map((file) => file.path));
          const contracts =
            shard.id.startsWith("contract-check-") ||
            context.structuralImpact?.contractBreaks.some((item) =>
              paths.has(item.path),
            );
          const security = context.structuralImpact?.securitySurfaces.some(
            (item) => paths.has(item.path),
          );
          const state = shard.files.some((file) =>
            /(?:auth|tenan|ledger|migrat|workflow|budget|contract|persist|publication)/iu.test(
              file.path,
            ),
          );
          return Math.min(
            4,
            1 +
              Number(Boolean(contracts)) +
              Number(Boolean(security)) +
              Number(state),
          );
        });
        const budget = createReviewBudgetPlan(
          plan.shards.length,
          initialPromptBytes * reviewGenerationCallsPerShard * 2,
          weights,
        );
        await services.ledger.configureReviewBudget(runId, budget);
        emit("review.budget_planned", {
          profile: budget.profile,
          estimatedInputBytes: budget.estimatedInputBytes,
          shards: weights.length,
        });
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
        selectedChangedLines: new Set(
          plan.shards.flatMap((shard) =>
            shard.changedLines.map(
              (line) => `${line.path}:${line.side}:${line.line}`,
            ),
          ),
        ).size,
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
        lanes: planReviewLanes(
          plan.shards.map((shard) => shard.byteLength),
          reviewExecutionLimits.concurrency,
        ).map((lane) => [...lane]),
        planDigest: digest,
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
    let budgetStop: ModelGenerationStopReason | undefined;
    const cancellation = new AbortController();
    let ready: ReturnType<typeof load> | undefined;
    const prepareReview = () =>
      (ready ??= (async () => {
        cancellation.signal.throwIfAborted();
        const loaded = await load();
        if (loaded.digest !== planning.planDigest)
          throw new NonRetryableError("Review plan changed during replay");
        return loaded;
      })());
    // A stable lane assignment survives replay; each lane starts its next item when free.
    // All lanes are joined, including after infrastructure failure or supersession.
    const settled = await Promise.allSettled(
      planning.lanes.map(async (lane) => {
        const completed = [];
        try {
          for (const index of lane) {
            cancellation.signal.throwIfAborted();
            const shardId = planning.shardIds[index]!;
            const admission = await runStep(
              `admit-shard-${index + 1}`,
              "preparation",
              async () => ({
                budgetStop:
                  await services.ledger.loadModelGenerationStop(runId),
                deadlineAt: Math.min(
                  planning.deadlineAt,
                  Date.now() + reviewTimeBudget.analysisMs,
                ),
              }),
            );
            if (admission.budgetStop !== undefined) {
              budgetStop = admission.budgetStop;
              completed.push({
                results: [
                  {
                    shardId,
                    shardIndex: index,
                    status: "failure" as const,
                    findings: [],
                    summary: "",
                    errorReason: "model_budget_exhausted",
                  },
                ],
                anyPromptTruncated: false,
              });
              continue;
            }
            const result = await (async () => {
              return await runStep(
                `analyze-shard-${index + 1}`,
                "analysis",
                async () => {
                  cancellation.signal.throwIfAborted();
                  if (Date.now() < admission.deadlineAt)
                    await services.executor.acquireReviewLease(
                      job.runId,
                      admission.deadlineAt,
                    );
                  const { context, plan, digest } = await prepareReview();
                  cancellation.signal.throwIfAborted();
                  const shard = plan.shards[index];
                  if (
                    !shard ||
                    shard.id !== shardId ||
                    digest !== planning.planDigest
                  )
                    throw new NonRetryableError(
                      "Review plan changed during replay",
                    );
                  if (Date.now() >= admission.deadlineAt) {
                    emitDiagnostic(
                      emit,
                      "review.shard_failed",
                      {
                        severity: "error",
                        shardIndex: index,
                        reason: "analysis_deadline",
                        deadlineAt: admission.deadlineAt,
                        overdueMs: Math.max(
                          0,
                          Date.now() - admission.deadlineAt,
                        ),
                      },
                      `${index}:analysis_deadline`,
                    );
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
                  }
                  return reviewShard({
                    job,
                    services,
                    shard,
                    shardCount: plan.shards.length,
                    structuralImpact: context.structuralImpact,
                    emit,
                    baseline: await services.ledger.loadPrFindings(prKey),
                    deadlineAt: admission.deadlineAt,
                    configuration: execution?.configuration,
                    cancellation,
                    memory: execution?.memory,
                    resolveGuidance,
                  });
                },
              );
            })();
            await services.ledger.completeReviewBudgetShard(runId, index);
            completed.push(result);
          }
          return completed;
        } catch (error) {
          cancellation.abort(error);
          throw error;
        }
      }),
    );
    cancellation.signal.throwIfAborted();
    for (const lane of settled)
      if (lane.status === "rejected") throw lane.reason;
    for (const lane of settled)
      if (lane.status === "fulfilled")
        for (const result of lane.value) {
          shardResults.push(...result.results);
          anyPromptTruncated ||= result.anyPromptTruncated;
        }
    shardResults.sort((left, right) => left.shardIndex - right.shardIndex);
    if (budgetStop !== undefined)
      emitDiagnostic(emit, "review.analysis_budget_stopped", {
        severity: "warning",
        rule: budgetStop,
        unstartedShards: shardResults.filter(
          (result) =>
            result.status === "failure" &&
            result.errorReason === "model_budget_exhausted",
        ).length,
      });
    // A denial in the final/only wave also yields explicit partial coverage.
    budgetStop ??= await runStep("analysis-budget-status", "preparation", () =>
      services.ledger.loadModelGenerationStop(runId),
    );
    if (
      budgetStop === undefined &&
      shardResults.length &&
      shardResults.every((result) => result.status === "failure") &&
      shardResults.some((result) => result.errorReason !== "analysis_deadline")
    )
      throw new Error("All review shards failed during model execution");
    return await runStep("analyze-review", "analysis", async () => {
      const { context, plan, digest } = await load();
      if (digest !== planning.planDigest)
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
        if (output.scopeStatus !== "complete")
          emitDiagnostic(emit, "review.analysis_partial", {
            severity: "warning",
            scopeStatus: output.scopeStatus,
            plannedShards: plan.shards.length,
            analyzedShards: 0,
            failedShards: 0,
            degradedShards: 0,
            omittedReasons: plan.omissionReasons
              .map((reason) => reason.code)
              .join(","),
          });
        return execution ? execution.finish(output) : output;
      }

      const evidenceVerifier = createCanonicalEvidenceVerifier(context);
      const rawAggregated = aggregateShardReviews(plan, shardResults, {
        evidenceVerifier,
        budgetStopReason: budgetStop,
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
              (
                result,
              ): result is Extract<ShardReviewResult, { status: "success" }> =>
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
                  const verified = evidenceVerifier.verify([
                    { ...resolution, severity: previous.severity },
                  ]);
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
        evidenceVerifier,
        budgetStopReason: budgetStop,
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
        investigations: shardResults
          .filter(
            (
              result,
            ): result is Extract<ShardReviewResult, { status: "success" }> =>
              result.status === "success" && result.isDegraded !== true,
          )
          .flatMap((result) => result.investigations ?? []),
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
      if (output.scopeStatus !== "complete" || output.isDegraded) {
        emitDiagnostic(emit, "review.analysis_partial", {
          severity: "warning",
          scopeStatus: output.scopeStatus,
          plannedShards: plan.shards.length,
          analyzedShards: shardResults.filter(
            (result) => result.status === "success",
          ).length,
          failedShards: shardResults.filter(
            (result) => result.status === "failure",
          ).length,
          degradedShards: shardResults.filter(
            (result) => result.status === "success" && result.isDegraded,
          ).length,
          omittedReasons: plan.omissionReasons
            .map((reason) => reason.code)
            .join(","),
        });
      }
      return execution ? execution.finish(output) : output;
    });
  } catch (error) {
    emitDiagnostic(emit, "review.analysis_failed", {
      severity: "error",
      errorKind: errorKind(error),
      reason:
        error instanceof RepositoryConfigurationError
          ? "repository_configuration"
          : (nonRetryableModelFailureCode(error) ?? "analysis_error"),
    });
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
