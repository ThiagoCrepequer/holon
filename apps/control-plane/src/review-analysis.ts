import {
  projectConfigurationGuidance,
  RepositoryConfigurationError,
} from "@holon/application";
import {
  aggregateShardReviews,
  createReviewRun,
  selectFindingsWithCanonicalEvidence,
} from "@holon/application";
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
import { reviewMessage } from "@holon/domain";
import {
  computeStableFingerprint,
  computeEvidenceFingerprint,
  createPrKey,
  reconcileFindings,
  type TrackedFinding,
} from "@holon/domain";
import {
  nonRetryableModelFailureCode,
  preflightReviewPrompt,
} from "@holon/model";
import { buildReviewPlan } from "@holon/repository-analysis";
import { NonRetryableError } from "cloudflare:workflows";

import { errorKind } from "./observability.js";
import type { ReviewServices } from "./review-services.js";
import { buildShardReviewContext } from "./review-shard-context.js";

export type { ReconciledReviewOutput } from "@holon/contracts";
export interface ReviewAnalysisExecution<T> {
  readonly configuration: RunConfigurationRef;
  runStep<R>(
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
  configuration?: RunConfigurationRef,
): Promise<{
  readonly results: readonly ShardReviewResult[];
  readonly anyPromptTruncated: boolean;
}> {
  const results: ShardReviewResult[] = [];
  let anyPromptTruncated = false;
  const identification = services.getProjectIdentification?.();
  for (const shard of plan.shards) {
    if (shardIndex !== undefined && shard.index !== shardIndex) continue;
    services.beginReviewShard?.(shard.index, plan.shards.length);
    const repositoryGuidance =
      configuration === undefined
        ? undefined
        : projectConfigurationGuidance(
            await services.ledger.loadRunConfiguration(configuration),
            shard.files.map((file) => file.path),
          );
    const shardContext = buildShardReviewContext(
      shard,
      structuralImpact,
      baseline,
      identification,
      inputTruncated,
      repositoryGuidance,
      deadlineAt,
    );
    try {
      const reviewResult = await services.model.review(job, shardContext);
      if (reviewResult.promptTruncated) {
        anyPromptTruncated = true;
      }
      const modelOutput = modelReviewOutputSchema.parse(reviewResult.output);
      const budgetExceeded = services.reviewToolBudgetExceeded?.() === true;
      const verifiedFindings = selectFindingsWithCanonicalEvidence(
        modelOutput.findings,
        shardContext,
      );
      const evidenceRejected =
        verifiedFindings.length !== modelOutput.findings.length;
      if (modelOutput.outputLimitations?.length || reviewResult.promptTruncated)
        emit?.("model.output_limits", {
          shardIndex: shard.index,
          limitationCodes: (modelOutput.outputLimitations ?? []).join(","),
          inputContextOmitted: reviewResult.promptTruncated,
        });
      results.push({
        findings: modelOutput.findings.filter((finding) =>
          verifiedFindings.includes(finding),
        ),
        resolutions: modelOutput.resolutions,
        isDegraded:
          modelOutput.isDegraded ||
          reviewResult.promptTruncated ||
          budgetExceeded ||
          evidenceRejected,
        outputLimitations: [
          ...new Set([
            ...(modelOutput.outputLimitations ?? []),
            ...(reviewResult.promptTruncated
              ? ["input_context_omitted" as const]
              : []),
            ...(budgetExceeded ? ["tool_budget_exhausted" as const] : []),
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
      if (failureCode !== undefined)
        throw new NonRetryableError(`HOLON_MODEL_NON_RETRYABLE:${failureCode}`);
      throw error;
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
export function analyzeReview<T>(
  job: ReviewJob,
  services: ReviewServices,
  emit: EmitReviewEvent,
  effectivePolicy: RepositoryPolicy | undefined,
  execution: ReviewAnalysisExecution<T>,
): Promise<T>;
export async function analyzeReview(
  job: ReviewJob,
  services: ReviewServices,
  emit: EmitReviewEvent,
  effectivePolicy?: RepositoryPolicy,
  execution?: ReviewAnalysisExecution<unknown>,
): Promise<unknown> {
  const runStep = <R>(
    name: string,
    phase: "preparation" | "analysis",
    fn: () => Promise<R>,
  ): Promise<R> => (execution ? execution.runStep(name, phase, fn) : fn());
  const load = async () => {
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
              context.truncated,
              guidance,
            ),
          );
        }
      }
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
        deadlineAt: Date.now() + 600_000,
      };
    });
    const shardResults: ShardReviewResult[] = [];
    let anyPromptTruncated = false;
    for (const [index, shardId] of planning.shardIds.entries()) {
      const result = await runStep(
        `analyze-shard-${index + 1}`,
        "analysis",
        async () => {
          const { context, plan } = await load();
          if (plan.shards[index]?.id !== shardId)
            throw new NonRetryableError("Review plan changed during replay");
          if (Date.now() >= planning.deadlineAt)
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
          const perShardDeadline =
            Date.now() +
            Math.max(
              1,
              Math.floor(
                (planning.deadlineAt - Date.now()) /
                  (planning.shardIds.length - index),
              ),
            );
          return reviewShards(
            job,
            services,
            plan,
            context.structuralImpact,
            context.truncated || plan.scopeStatus === "partial_by_policy",
            emit,
            await services.ledger.loadPrFindings(prKey),
            index,
            perShardDeadline,
            execution?.configuration,
          );
        },
      ).catch((error: unknown) => {
        if (planning.shardIds.length === 1) throw error;
        return {
          anyPromptTruncated: false,
          results: [
            {
              shardId,
              shardIndex: index,
              status: "failure" as const,
              findings: [],
              summary: "",
              errorReason: `model_${nonRetryableModelFailureCode(error) ?? errorKind(error)}`,
            },
          ],
        };
      });
      shardResults.push(...result.results);
      anyPromptTruncated ||= result.anyPromptTruncated;
    }
    if (
      shardResults.length &&
      shardResults.every((result) => result.status === "failure")
    )
      throw new Error("All review shards failed during model execution");
    return await runStep("analyze-review", "analysis", async () => {
      const { context, plan } = await load();
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

      const successfulSummaries = shardResults
        .filter((r) => r.status === "success" && r.summary.trim().length > 0)
        .map((r) => r.summary.trim());

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
              (result.resolutions ?? []).map(async (resolution) => {
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
                const verified = selectFindingsWithCanonicalEvidence(
                  [{ ...resolution, severity: previous.severity }],
                  context,
                );
                if (!verified.length) return [];
                const evidenceFingerprint = await computeEvidenceFingerprint(
                  resolution.location.path,
                  resolution.evidence,
                );
                return previous.evidenceFingerprint === evidenceFingerprint
                  ? []
                  : [resolution.fingerprint];
              }),
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
      let unifiedSummary: string | undefined;
      if (
        rawAggregated.scopeStatus === "complete" &&
        rawAggregated.isDegraded !== true &&
        !context.truncated &&
        (reconciled.summary.unverifiedCount ?? 0) === 0 &&
        successfulSummaries.length > 1 &&
        typeof services.model.synthesizeReviewSummary === "function"
      ) {
        try {
          unifiedSummary = await services.model.synthesizeReviewSummary(job, {
            output:
              execution === undefined
                ? undefined
                : (
                    await services.ledger.loadRunConfiguration(
                      execution.configuration,
                    )
                  ).config.output,
            shardSummaries: successfulSummaries,
            verifiedFindings: reconciled.activeFindings.map((finding) => ({
              diagnostic: finding.diagnostic,
              severity: finding.severity,
              path: finding.location.path,
            })),
          });
        } catch {
          unifiedSummary = reviewMessage(
            outputPreferences.language,
            "synthesisUnavailable",
          );
        }
      }

      const finalAggregated = aggregateShardReviews(plan, shardResults, {
        language: outputPreferences.language,
        canonicalFindings: reconciled.activeFindings,
        publication: {
          findings: reconciled.activeFindings,
          output: outputPreferences,
        },
        unifiedSummary,
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
