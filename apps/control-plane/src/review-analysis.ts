import {
  aggregateShardReviews,
  createReviewRun,
  selectFindingsWithCanonicalEvidence,
} from "@holon/application";
import {
  modelReviewOutputSchema,
  reconciledReviewOutputSchema,
  type ReconciledReviewOutput,
  type ReviewJob,
  type RepositoryPolicy,
  type ShardReviewResult,
  type StructuralImpactReport,
} from "@holon/contracts";
import {
  computeStableFingerprint,
  computeEvidenceFingerprint,
  createPrKey,
  reconcileFindings,
  type TrackedFinding,
} from "@holon/domain";
import {
  ModelProviderRequestError,
  nonRetryableModelFailureCode,
} from "@holon/model";
import { buildReviewPlan } from "@holon/repository-analysis";
import { NonRetryableError } from "cloudflare:workflows";

import { resolveReviewGuidance } from "./review-guidance.js";
import type { ReviewServices } from "./review-services.js";

export type { ReconciledReviewOutput } from "@holon/contracts";
export interface ReviewAnalysisExecution<T> {
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
  effectivePolicy?: RepositoryPolicy,
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
      effectivePolicy,
    );
    const shardContext = {
      reviewGuidance: await resolveReviewGuidance(
        effectivePolicy,
        shard.files.map((file) => file.path),
        identification,
      ),
      deadlineAt,
      priorFindings: baseline
        .filter(
          (f) =>
            ["new", "persistent", "reintroduced"].includes(f.status) &&
            shard.files.some((file) => file.path === f.filePath),
        )
        .slice(0, 8)
        .map(({ fingerprint, diagnostic, filePath, severity }) => ({
          fingerprint,
          diagnostic,
          filePath,
          severity,
        })),
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
      const reviewResult = await reviewer.model.review(job, shardContext);
      if (reviewResult.promptTruncated) {
        anyPromptTruncated = true;
      }
      const modelOutput = modelReviewOutputSchema.parse(reviewResult.output);
      const budgetExceeded = reviewer.toolBudgetExceeded();
      const verifiedFindings = selectFindingsWithCanonicalEvidence(
        modelOutput.findings,
        shardContext,
      );
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
      if (
        failureCode === undefined &&
        !(error instanceof ModelProviderRequestError)
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
              "Eligible patches or context sections were omitted by the executor budget.",
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
        deadlineAt: Date.now() + 600_000,
      };
    });
    const shardResults: ShardReviewResult[] = [];
    let anyPromptTruncated = false;
    const settled = await Promise.allSettled(
      planning.shardIds.map(async (shardId, index) => {
        return await runStep(
          `analyze-shard-${index + 1}`,
          "analysis",
          async () => {
            const { context, plan } = await load();
            if (
              plan.shards[index]?.id !== shardId ||
              (await planDigest(plan)) !== planning.planDigest
            )
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
            return reviewShards(
              job,
              services,
              plan,
              context.structuralImpact,
              context.truncated || plan.scopeStatus === "partial_by_policy",
              emit,
              await services.ledger.loadPrFindings(prKey),
              index,
              planning.deadlineAt,
              effectivePolicy,
            );
          },
        );
      }),
    );
    // Join every in-flight shard before terminal cleanup. Infrastructure/state
    // failures retain their cause and cannot become a publishable partial review.
    for (const result of settled)
      if (result.status === "rejected") throw result.reason;
    for (const completed of settled) {
      if (completed.status !== "fulfilled") continue;
      const result = completed.value;
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
      if ((await planDigest(plan)) !== planning.planDigest)
        throw new NonRetryableError("Review plan changed during replay");

      const verdictPolicy =
        context.verdictStrictness === "block_all_confident_medium"
          ? { mediumSeverityThreshold: 1 }
          : undefined;

      if (plan.scopeStatus === "unsupported" || plan.shards.length === 0) {
        const output: ReconciledReviewOutput = {
          ...aggregateShardReviews(plan, [], { verdictPolicy }),
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
      const output = reconciledReviewOutputSchema.parse({
        ...finalAggregated,
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
