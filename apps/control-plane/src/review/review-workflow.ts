import { RepositoryConfigurationError } from "@holon/application";
import {
  createReviewRun,
  planInlinePublications,
  determineCheckRunConclusion,
  formatCheckRunOutput,
  renderFinding,
} from "@holon/application";
import type { RunConfigurationRef } from "@holon/contracts";
import {
  buildReviewAnalysisCheckpoint,
  runClaimResultSchema,
  reviewJobSchema,
  type CheckRunConclusion,
  type CheckRunOutput,
  type RepositoryPolicy,
  type ReviewJob,
} from "@holon/contracts";
import { reviewMessage, type ReviewLanguage } from "@holon/domain";
import {
  classifyFindingPublication,
  createFindingId,
  createPrKey,
  type RunState,
  type RunId,
} from "@holon/domain";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import { terminateWorkflowIfActive } from "../ledger/workflow-superseding.js";
import { consoleLogger, errorKind } from "../observability.js";
import {
  isReviewMutationNotAuthorizedError,
  publishAuthorized,
  publishResolutionAuthorized,
  publishFailureNoticeAuthorized,
} from "./authorized-publication.js";
import { runProjectIdentification } from "./project-identification-phase.js";
import { analyzeReview } from "./review-analysis.js";
import { loadReviewWithCurrentFeedback } from "./review-feedback-refresh.js";
import {
  createReviewServices,
  type GitHubMutationContext,
  type ReviewRuntime,
} from "./review-services.js";
import {
  configurationScopePolicy,
  resolveRunConfiguration,
} from "./run-configuration-resolver.js";
import { configurationStep } from "./workflow-policy.js";
import {
  durationFrom,
  eventId,
  modelStep,
  publicationStep,
  repositoryStep,
  stateStep,
} from "./workflow-policy.js";

export type { ReviewRuntime } from "./review-services.js";
export { parseAppId } from "../github/credential-broker.js";

const repositoryConfigurationFailureMessages: Readonly<
  Record<string, import("@holon/domain").ReviewMessageCode>
> = {
  conflicting_sources: "configurationConflict",
  invalid_yaml: "configurationYaml",
  invalid_configuration: "configurationSchema",
  invalid_file: "configurationFile",
  access_denied: "configurationAccess",
  snapshot_unavailable: "configurationSnapshot",
  too_large: "configurationSize",
  budget_exceeded: "configurationBudget",
  snapshot_mismatch: "configurationIntegrity",
  snapshot_corrupt: "configurationIntegrity",
  snapshot_conflict: "configurationIntegrity",
  missing_project_root: "configurationRoot",
  missing_reference: "configurationReference",
  excluded_reference: "configurationReference",
  invalid_compatibility: "configurationCompatibility",
};
function repositoryConfigurationFailureMessage(
  error: unknown,
  language: import("@holon/domain").ReviewLanguage,
): string {
  const code =
    error instanceof RepositoryConfigurationError
      ? error.code
      : error instanceof Error &&
          error.message.startsWith("HOLON_REPOSITORY_CONFIG:")
        ? error.message.slice("HOLON_REPOSITORY_CONFIG:".length)
        : undefined;
  return reviewMessage(
    language,
    (code === undefined
      ? undefined
      : repositoryConfigurationFailureMessages[code]) ?? "configurationUnknown",
  );
}

export class ReviewWorkflow extends WorkflowEntrypoint<
  Cloudflare.Env,
  ReviewJob
> {
  public override async run(
    event: Readonly<WorkflowEvent<ReviewJob>>,
    step: WorkflowStep,
  ) {
    return await executeReviewWorkflow(this.env, event, step);
  }
}

export async function executeReviewWorkflow(
  env: Cloudflare.Env,
  rawEvent: Readonly<WorkflowEvent<ReviewJob>>,
  step: WorkflowStep,
  runtime: ReviewRuntime = {},
) {
  const job = reviewJobSchema.parse(rawEvent.payload);
  const workflowInstanceId = rawEvent.instanceId;
  const logger = runtime.logger ?? consoleLogger;
  const now = runtime.now ?? (() => new Date().toISOString());
  const logContext = {
    pullRequestNumber: job.envelope.pullRequest.number,
    repositoryId: job.envelope.repository.id,
    runId: job.runId,
    workflowInstanceId,
  };
  const emit = (
    event: string,
    fields: Readonly<
      Record<string, boolean | number | string | undefined>
    > = {},
    suffix?: number | string,
  ) =>
    logger.emit(event, {
      eventId: eventId(
        workflowInstanceId,
        event,
        suffix ??
          (typeof fields.shardIndex === "number"
            ? fields.shardIndex
            : undefined),
      ),
      ...logContext,
      ...fields,
    });
  const services = createReviewServices(env, job, runtime, logger, {
    eventId: eventId(workflowInstanceId, "model.usage"),
    ...logContext,
  });
  const run = createReviewRun(job);
  const prKey = createPrKey({
    provider: "github",
    pullRequestNumber: job.envelope.pullRequest.number,
    repositoryId: job.envelope.repository.id,
  });
  let repositoryStarted = false;
  let runClaimed = false;
  let effectivePolicy: RepositoryPolicy | undefined;
  let configuration: RunConfigurationRef | undefined;
  let outputLanguage: ReviewLanguage = "en";
  let phase:
    | "admission"
    | "configuration"
    | "preparation"
    | "identification"
    | "analysis"
    | "publication" = "admission";

  const moveTo = async (
    stepName: string,
    expected: RunState,
    next: RunState,
    cleanup: boolean,
  ): Promise<string> =>
    await step.do(stepName, stateStep, async () => {
      const occurredAt = now();
      if (cleanup) {
        await services.ledger.transitionAndRequestCleanup(
          run.id,
          expected,
          next,
          occurredAt,
          `${workflowInstanceId}:${stepName}`,
        );
        return occurredAt;
      }
      const current = await services.ledger.runState(run.id);
      if (current === next) return occurredAt;
      if (current !== expected) {
        throw new Error(
          `Review run cannot execute ${stepName} from ${current ?? "missing"}`,
        );
      }
      await services.ledger.transition(
        run.id,
        expected,
        next,
        occurredAt,
        `${workflowInstanceId}:${stepName}`,
      );
      return occurredAt;
    });

  const refsAreCurrent = async (
    github: GitHubMutationContext,
  ): Promise<boolean> => {
    const refs = await github.readCurrentRefs();
    return !(
      refs.headSha !== job.envelope.pullRequest.headSha ||
      refs.baseSha !== job.envelope.pullRequest.baseSha
    );
  };

  const authorizeMutation = async (
    github: GitHubMutationContext,
    purpose: "failure" | "review",
  ): Promise<boolean> => {
    if (!(await refsAreCurrent(github))) return false;
    return await services.ledger.authorizeMutation(run.id, purpose);
  };

  const completeObsolete = async (
    expected: "publishing" | "running",
    stepName: string,
    cleanup: boolean,
  ) => {
    if (repositoryStarted) {
      await updateCheckRunCompleted(
        "cancel-check-run",
        "cancelled",
        {
          summary: reviewMessage(outputLanguage, "superseded"),
          title: reviewMessage(outputLanguage, "supersededTitle"),
        },
        false,
      );
    }
    const occurredAt = await moveTo(stepName, expected, "obsolete", cleanup);

    const result = { findingsPublished: 0, outcome: "obsolete" } as const;
    emit("review.completed", {
      durationMs: durationFrom(rawEvent.timestamp, occurredAt),
      ...result,
    });
    return result;
  };

  const checkTarget = {
    baseSha: job.envelope.pullRequest.baseSha,
    installationId: job.envelope.installationId,
    repositoryId: job.envelope.repository.id,
    owner: job.envelope.repository.owner,
    repo: job.envelope.repository.name,
    pullNumber: job.envelope.pullRequest.number,
  };
  const ensureCheckRunStarted = async (): Promise<number | undefined> =>
    await step
      .do(
        "start-check-run",
        publicationStep,
        async () => {
          await services.ledger.scheduleCheckRun(run.id, {
            ...checkTarget,
            language: outputLanguage,
            input: {
              externalId: run.id,
              headSha: job.envelope.pullRequest.headSha,
              status: "in_progress",
              startedAt: now(),
              output: {
                title: reviewMessage(outputLanguage, "inProgressTitle"),
                summary: reviewMessage(outputLanguage, "inProgress"),
              },
            },
          });
          return await services.reconcileCheckRun(run.id);
        },
        {
          rollback: async () => {
            if ((await services.ledger.runState(run.id)) !== "obsolete") return;
            await services.ledger.scheduleCheckRun(run.id, {
              ...checkTarget,
              language: outputLanguage,
              input: {
                externalId: run.id,
                headSha: job.envelope.pullRequest.headSha,
                status: "completed",
                conclusion: "cancelled",
                completedAt: now(),
                output: {
                  title: reviewMessage(outputLanguage, "supersededTitle"),
                  summary: reviewMessage(outputLanguage, "superseded"),
                },
              },
            });
            await services.reconcileCheckRun(run.id);
          },
          rollbackConfig: {
            retries: {
              backoff: "exponential",
              delay: "5 seconds",
              limit: 4,
            },
            timeout: "2 minutes",
          },
        },
      )
      .catch((checkRunError: unknown) => {
        emit("check_run.start_failed", {
          errorKind: errorKind(checkRunError),
        });
        return undefined;
      });

  const updateCheckRunCompleted = async (
    stepName: string,
    conclusion: CheckRunConclusion,
    output: CheckRunOutput,
    requireCurrentRefs = true,
  ): Promise<boolean> =>
    await step
      .do(stepName, publicationStep, async () => {
        await services.ledger.scheduleCheckRun(run.id, {
          ...checkTarget,
          language: outputLanguage,
          input: {
            externalId: run.id,
            headSha: job.envelope.pullRequest.headSha,
            status: "completed",
            conclusion,
            completedAt: now(),
            output,
          },
        });
        if (
          requireCurrentRefs &&
          !(await refsAreCurrent(await services.createMutationContext()))
        )
          return false;
        await services.reconcileCheckRun(run.id);
        return true;
      })
      .catch((checkRunError: unknown) => {
        emit("check_run.update_failed", {
          errorKind: errorKind(checkRunError),
          stepName,
        });
        return true;
      });

  try {
    const claim = await step.do("claim-run", stateStep, async () => {
      const result = runClaimResultSchema.parse(
        await services.ledger.claimRun(run, workflowInstanceId),
      );
      emit("review.started", {
        eventTimestamp: rawEvent.timestamp.toISOString(),
      });
      return result;
    });
    if (claim.outcome === "duplicate") {
      return { findingsPublished: 0, outcome: "duplicate" } as const;
    }
    runClaimed = true;

    for (const [index, superseded] of claim.supersededWorkflows.entries()) {
      await step
        .do(
          `terminate-superseded-workflow-${index + 1}`,
          stateStep,
          async () => {
            const outcome = await terminateWorkflowIfActive(
              services.workflow,
              superseded.workflowInstanceId,
            );
            await services.ledger.completeWorkflowSupersession(
              superseded.runId as RunId,
              now(),
            );
            emit(
              "workflow.superseded",
              {
                outcome,
                supersededRunId: superseded.runId,
              },
              index + 1,
            );
          },
        )
        .catch((terminationError: unknown) => {
          // Active termination reduces wasted inference, but stale-head and
          // publication authorization remain the correctness boundary. The
          // Durable Object alarm retains and retries the pending obligation.
          emit(
            "workflow.supersession_deferred",
            {
              errorKind: errorKind(terminationError),
              supersededRunId: superseded.runId,
            },
            index + 1,
          );
        });
    }

    await step.do("start-run", stateStep, async () => {
      const current = await services.ledger.runState(run.id);
      if (current !== "running" && current !== "publishing") {
        if (current !== "queued" && current !== "failed_retryable") {
          throw new Error(
            `Review run cannot start from ${current ?? "missing"}`,
          );
        }
        await services.ledger.transition(
          run.id,
          current,
          "running",
          now(),
          `${workflowInstanceId}:start-run:${current}`,
        );
      }
    });

    const initialRefsAreCurrent = await step.do(
      "revalidate-initial-refs",
      publicationStep,
      async () => {
        const isLatest = await services.ledger.isLatestRun(run.id);
        if (!isLatest) return false;
        const refs = await services.readCurrentRefs();
        return (
          refs.headSha === job.envelope.pullRequest.headSha &&
          refs.baseSha === job.envelope.pullRequest.baseSha
        );
      },
    );
    if (!initialRefsAreCurrent) {
      return await completeObsolete(
        "running",
        "mark-obsolete-before-preparation",
        false,
      );
    }

    repositoryStarted = true;
    phase = "configuration";
    configuration = await step.do(
      "resolve-repository-config",
      configurationStep,
      async () => {
        try {
          return await resolveRunConfiguration(
            job,
            services.ledger,
            async () => {
              const session = await services.createSession();
              return session.configurationReader(
                job.envelope.repository.owner,
                job.envelope.repository.name,
                job.envelope.pullRequest.baseSha,
              );
            },
            emit,
          );
        } catch (error) {
          if (error instanceof RepositoryConfigurationError)
            emit("configuration.rejected", {
              code: error.code,
              location: error.location,
            });
          if (
            error instanceof RepositoryConfigurationError &&
            error.code !== "transient_failure"
          )
            throw new NonRetryableError(
              `HOLON_REPOSITORY_CONFIG:${error.code}`,
            );
          throw error;
        }
      },
    );
    const configurationRef = configuration;
    const preferences = await step.do(
      "load-repository-scope",
      stateStep,
      async () => {
        const snapshot =
          await services.ledger.loadRunConfiguration(configurationRef);
        return {
          policy: configurationScopePolicy(snapshot),
          language: snapshot.config.output.language,
        };
      },
    );
    effectivePolicy = preferences.policy;
    outputLanguage = preferences.language;
    await ensureCheckRunStarted();

    repositoryStarted = true;
    phase = "preparation";
    await step.do("prepare-repository", repositoryStep, async () => {
      await services.registerCredentialScope();
      const policy = configurationScopePolicy(
        await services.ledger.loadRunConfiguration(configurationRef),
      );
      const prepared = await services.prepareRepository(1, policy);
      emit("repository.prepared", {
        changedLineCount: prepared.changedLineCount,
        contextBytes: prepared.contextBytes,
        fileCount: prepared.fileCount,
        truncated: prepared.truncated,
      });
      return prepared;
    });

    if (services.identifyProjects && effectivePolicy) {
      phase = "identification";
      await runProjectIdentification({
        job,
        policy: effectivePolicy,
        configuration: configurationRef,
        services,
        step,
        emit,
      });
    }

    phase = "analysis";
    let output = await analyzeReview(job, services, emit, effectivePolicy, {
      configuration: configurationRef,
      runStep: async (name, stepPhase, callback) =>
        await step
          .do(
            name,
            name === "plan-review" ? repositoryStep : modelStep,
            callback,
          )
          .catch((error: unknown) => {
            try {
              emit(
                "review.analysis_step_failed",
                {
                  severity: "error",
                  stepName: name,
                  phase: stepPhase,
                  errorKind: errorKind(error),
                },
                name,
              );
            } catch {
              // A log sink failure cannot replace the failed workflow step.
            }
            throw error;
          }),
      finish: (result) => services.ledger.saveReviewAnalysis(run.id, result),
    });

    phase = "publication";
    await moveTo("begin-publication", "running", "publishing", false);
    const currentBeforePublication = await step.do(
      "revalidate-current-refs",
      publicationStep,
      async () => {
        const isLatest = await services.ledger.isLatestRun(run.id);
        if (!isLatest) return false;
        const refs = await services.readCurrentRefs();
        return (
          refs.headSha === job.envelope.pullRequest.headSha &&
          refs.baseSha === job.envelope.pullRequest.baseSha
        );
      },
    );
    if (!currentBeforePublication) {
      return await completeObsolete(
        "publishing",
        "mark-obsolete-and-schedule-cleanup",
        true,
      );
    }

    let findingsPublished = 0;
    const publishedCommentIds = new Map<string, number>();

    const inlinePlan = await step.do(
      "plan-inline-publications",
      stateStep,
      async () => {
        const snapshot =
          await services.ledger.loadRunConfiguration(configurationRef);
        const detail = await services.ledger.loadReviewAnalysis(run.id);
        return planInlinePublications(
          detail.activeFindings,
          snapshot.config.output.maxInlineComments,
        );
      },
    );
    const selectedInlineFindings = new Set(inlinePlan.inlineFingerprints);
    for (const [index, finding] of output.activeFindings.entries()) {
      if (!selectedInlineFindings.has(finding.fingerprint)) continue;

      const result = await step.do(
        `publish-inline-${index + 1}`,
        publicationStep,
        async () => {
          const github = await services.createMutationContext();
          try {
            const detail = await loadReviewWithCurrentFeedback(
              services.ledger,
              run.id,
              prKey,
            );
            const effectiveFinding = detail.activeFindings.find(
              (candidate) => candidate.fingerprint === finding.fingerprint,
            );
            if (
              effectiveFinding === undefined ||
              classifyFindingPublication(effectiveFinding) !== "inline"
            )
              return { authorized: true, published: false } as const;
            const findingId = await createFindingId(run.id, {
              diagnostic: effectiveFinding.diagnostic,
              endLine: effectiveFinding.location.line,
              path: effectiveFinding.location.path,
              startLine:
                effectiveFinding.location.startLine ??
                effectiveFinding.location.line,
            });
            let commentId: number | undefined;
            const published = await publishAuthorized(
              services.ledger,
              github.publisher,
              run.id,
              findingId,
              "inline",
              renderFinding(effectiveFinding, detail.output.language),
              {
                line: effectiveFinding.location.line,
                path: effectiveFinding.location.path,
                side: "RIGHT",
                ...(effectiveFinding.location.startLine !== undefined
                  ? { startLine: effectiveFinding.location.startLine }
                  : {}),
              },
              () => authorizeMutation(github, "review"),
              (id) => {
                commentId = id;
              },
            );
            return { authorized: true, commentId, published } as const;
          } catch (error) {
            if (isReviewMutationNotAuthorizedError(error)) {
              return { authorized: false, published: false } as const;
            }
            throw error;
          }
        },
      );
      if (!result.authorized) {
        return await completeObsolete(
          "publishing",
          "mark-obsolete-during-publication",
          true,
        );
      }
      if (result.commentId !== undefined) {
        publishedCommentIds.set(finding.fingerprint, result.commentId);
      }
      if (result.published) findingsPublished += 1;
    }

    // Notify resolutions on original comment threads
    for (let index = 0; index < output.resolvedFindingsCount; index += 1) {
      const resolutionAuthorized = await step.do(
        `notify-resolved-${index + 1}`,
        publicationStep,
        async () => {
          const github = await services.createMutationContext();
          const original = (await services.ledger.loadReviewAnalysis(run.id))
            .resolvedFindings[index];
          const refreshed = await loadReviewWithCurrentFeedback(
            services.ledger,
            run.id,
            prKey,
          );
          const resolved = refreshed.resolvedFindings.find(
            (finding) => finding.fingerprint === original?.fingerprint,
          );
          if (resolved?.githubCommentId === undefined) return true;
          try {
            await publishResolutionAuthorized(
              services.ledger,
              github.publisher,
              run.id,
              resolved,
              job.envelope.pullRequest.headSha,
              () => authorizeMutation(github, "review"),
              refreshed.output.language,
            );
            return true;
          } catch (error) {
            if (isReviewMutationNotAuthorizedError(error)) return false;
            throw error;
          }
        },
      );
      if (!resolutionAuthorized) {
        return await completeObsolete(
          "publishing",
          "mark-obsolete-before-resolution-reply",
          true,
        );
      }
    }

    const summaryResult = await step.do(
      "publish-summary",
      publicationStep,
      async () => {
        const github = await services.createMutationContext();
        const currentReview = await loadReviewWithCurrentFeedback(
          services.ledger,
          run.id,
          prKey,
        );
        const summaryText = currentReview.summary;
        try {
          const published = await publishAuthorized(
            services.ledger,
            github.publisher,
            run.id,
            "summary",
            "summary",
            summaryText,
            { event: currentReview.verdict },
            () => authorizeMutation(github, "review"),
          );
          return {
            authorized: true,
            published,
            checkpoint: buildReviewAnalysisCheckpoint(currentReview),
          } as const;
        } catch (error) {
          if (isReviewMutationNotAuthorizedError(error)) {
            return { authorized: false, published: false } as const;
          }
          throw error;
        }
      },
    );
    if (!summaryResult.authorized) {
      return await completeObsolete(
        "publishing",
        "mark-obsolete-before-summary",
        true,
      );
    }

    output = summaryResult.checkpoint;

    // Persist tracked findings in ledger
    await step.do("save-pr-findings", publicationStep, async () => {
      const detail = await services.ledger.loadReviewAnalysis(run.id);
      await services.ledger.savePrFindings(
        prKey,
        detail.updatedTrackedFindings.map((finding) => ({
          ...finding,
          githubCommentId:
            publishedCommentIds.get(finding.fingerprint) ??
            finding.githubCommentId,
        })),
        run.id,
      );
    });
    const { checkRunConclusion, checkRunOutput, checkpoint } = await step.do(
      "format-check-run-output",
      stateStep,
      async () => {
        const detail = await loadReviewWithCurrentFeedback(
          services.ledger,
          run.id,
          prKey,
        );
        const isPartial =
          detail.scopeStatus === "partial_by_policy" ||
          detail.scopeStatus === "partial_by_failure";
        const conclusion = determineCheckRunConclusion(
          detail.findings,
          isPartial,
          detail.verdict,
        );
        const formattedOutput = formatCheckRunOutput({
          durationMs: durationFrom(rawEvent.timestamp, now()),
          effectivePolicyDigest: detail.effectivePolicyDigest,
          findings: detail.findings,
          partial: isPartial,
          policySource: detail.policySource,
          reconciliation: detail.reconciliation,
          scopeStatus: detail.scopeStatus,
          shardsAnalyzed: detail.shardsAnalyzed,
          structuralImpact: detail.structuralImpact,
          sourceDigest: detail.sourceDigest,
          summary: detail.summary,
          totalShards: detail.totalShards,
          verdict: detail.verdict,
          waiversCount: detail.waiversCount,
        });
        return {
          checkRunConclusion: conclusion,
          checkRunOutput: formattedOutput,
          checkpoint: buildReviewAnalysisCheckpoint(detail),
        };
      },
    );
    output = checkpoint;
    await step.do("record-review-decision", stateStep, async () => {
      const snapshot =
        await services.ledger.loadRunConfiguration(configurationRef);
      await services.ledger.recordReviewDecision(run.id, {
        output: snapshot.config.output,
        verdictPolicy: {
          mediumSeverityThreshold:
            snapshot.config.verdictStrictness === "block_all_confident_medium"
              ? 1
              : 2,
        },
        headSha: job.envelope.pullRequest.headSha,
        isDegraded: output.isDegraded === true,
        scopeStatus: output.scopeStatus,
        shardsAnalyzed: output.shardsAnalyzed,
        totalShards: output.totalShards,
      });
    });

    const checkRunAuthorized = await updateCheckRunCompleted(
      "complete-check-run",
      checkRunConclusion,
      checkRunOutput,
    );
    if (!checkRunAuthorized) {
      return await completeObsolete(
        "publishing",
        "mark-obsolete-before-terminal-check-run",
        true,
      );
    }

    const completedAt = await moveTo(
      "complete-run-and-schedule-cleanup",
      "publishing",
      "completed",
      true,
    );

    const result = { findingsPublished, outcome: "completed" } as const;
    emit("review.completed", {
      durationMs: durationFrom(rawEvent.timestamp, completedAt),
      ...result,
    });
    return result;
  } catch (error) {
    const isConfigurationError =
      error instanceof RepositoryConfigurationError ||
      (error instanceof Error &&
        error.message.startsWith("HOLON_REPOSITORY_CONFIG:"));

    const configurationErrorMessage = repositoryConfigurationFailureMessage(
      error,
      outputLanguage,
    );

    const terminal = await step
      .do("mark-review-terminal-and-schedule-cleanup", stateStep, async () => {
        const occurredAt = now();
        const changed = await services.ledger.markTerminalAndRequestCleanup(
          run.id,
          occurredAt,
          repositoryStarted,
        );
        return { changed, occurredAt };
      })
      .catch((terminalError: unknown) => {
        emit("review.terminalization_failed", {
          errorKind: errorKind(terminalError),
        });
        return undefined;
      });

    emit("review.failed", {
      durationMs:
        terminal === undefined
          ? 0
          : durationFrom(rawEvent.timestamp, terminal.occurredAt),
      errorKind: errorKind(error),
      phase,
      severity: "error",
    });
    if (runClaimed) {
      await ensureCheckRunStarted();
      await updateCheckRunCompleted("fail-check-run", "failure", {
        summary: isConfigurationError
          ? reviewMessage(outputLanguage, "configurationInvalid", {
              reason: configurationErrorMessage,
            })
          : reviewMessage(outputLanguage, "failed"),
        title: isConfigurationError
          ? reviewMessage(outputLanguage, "configurationInvalidTitle")
          : reviewMessage(outputLanguage, "failedTitle"),
      });
    }

    if (runClaimed && terminal?.changed === true) {
      await step
        .do("publish-failure-notice", publicationStep, async () => {
          const github = await services.createMutationContext();
          const noticeBody = isConfigurationError
            ? `${reviewMessage(outputLanguage, "configurationInvalid", { reason: configurationErrorMessage })}\n\n${reviewMessage(outputLanguage, "configurationFix")}`
            : reviewMessage(outputLanguage, "failureNotice");
          await publishFailureNoticeAuthorized(
            github.publisher,
            run.id,
            () => authorizeMutation(github, "failure"),
            noticeBody,
          );
        })
        .catch((publicationError: unknown) => {
          emit("review.failure_notice_failed", {
            errorKind: errorKind(publicationError),
          });
        });
    }

    // Preserve the original failure after scheduling cleanup and attempting the notice.
    throw error;
  }
}
