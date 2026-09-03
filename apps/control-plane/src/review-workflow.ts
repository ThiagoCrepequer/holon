import {
  aggregateShardReviews,
  createReviewRun,
  determineCheckRunConclusion,
  formatCheckRunOutput,
  renderFinding,
} from "@holon/application";
import {
  modelReviewOutputSchema,
  reviewJobSchema,
  type AggregatedReviewResult,
  type CheckRunConclusion,
  type CheckRunOutput,
  type ReviewJob,
  type ShardReviewResult,
} from "@holon/contracts";
import {
  appendCiEvidenceToSummary,
  classifyFindingPublication,
  computeStableFingerprint,
  createFindingId,
  createPrKey,
  reconcileFindings,
  type ReconciledFinding,
  type RunState,
  type TrackedFinding,
} from "@holon/domain";
import { nonRetryableModelFailureCode } from "@holon/model";
import { buildReviewPlan } from "@holon/repository-analysis";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import {
  isReviewMutationNotAuthorizedError,
  publishAuthorized,
  publishFailureNoticeAuthorized,
} from "./authorized-publication.js";
import { consoleLogger, errorKind } from "./observability.js";
import {
  createReviewServices,
  type GitHubMutationContext,
  type ReviewRuntime,
} from "./review-services.js";
import {
  causalVersionForJob,
  durationFrom,
  eventId,
  modelStep,
  publicationStep,
  repositoryStep,
  stateStep,
} from "./workflow-policy.js";

export type { ReviewRuntime } from "./review-services.js";
export { parseAppId } from "./credential-broker.js";

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

function contextBytes(context: {
  readonly files: readonly { readonly patch: string }[];
}): number {
  return context.files.reduce(
    (total, file) => total + new TextEncoder().encode(file.patch).byteLength,
    0,
  );
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
      eventId: eventId(workflowInstanceId, event, suffix),
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

  const authorizeMutation = async (
    github: GitHubMutationContext,
    purpose: "failure" | "review",
  ): Promise<boolean> => {
    if ((await github.readCurrentHead()) !== job.envelope.pullRequest.headSha) {
      return false;
    }
    return await services.ledger.authorizeMutation(run.id, purpose);
  };

  const completeObsolete = async (
    expected: "publishing" | "running",
    stepName: string,
    cleanup: boolean,
  ) => {
    if (repositoryStarted) {
      await updateCheckRunCompleted("cancel-check-run", "cancelled", {
        summary:
          "A newer commit was pushed to this pull request. This review run was cancelled.",
        title: "Holon Review Superseded",
      });
    }
    const occurredAt = await moveTo(stepName, expected, "obsolete", cleanup);
    const result = { findingsPublished: 0, outcome: "obsolete" } as const;
    emit("review.completed", {
      durationMs: durationFrom(rawEvent.timestamp, occurredAt),
      ...result,
    });
    return result;
  };

  const ensureCheckRunStarted = async (): Promise<number | undefined> =>
    await step
      .do("start-check-run", publicationStep, async () => {
        let checkRunId = await services.ledger.checkRunId(run.id);
        if (checkRunId !== undefined) return checkRunId;

        const github = await services.createMutationContext();
        if (github.publisher.findCheckRunByExternalId !== undefined) {
          const existingId = await github.publisher.findCheckRunByExternalId(
            run.id,
          );
          if (existingId !== undefined) {
            await services.ledger.recordCheckRunId(run.id, existingId);
            return existingId;
          }
        }

        if (github.publisher.createCheckRun !== undefined) {
          checkRunId = await github.publisher.createCheckRun({
            externalId: run.id,
            headSha: job.envelope.pullRequest.headSha,
            name: "Holon Review",
            output: {
              summary:
                "Holon is reviewing pull request changes for functional regressions, contract breaks, and security flaws.",
              title: "Holon Review in progress",
            },
            startedAt: now(),
            status: "in_progress",
          });
          await services.ledger.recordCheckRunId(run.id, checkRunId);
          return checkRunId;
        }
        return undefined;
      })
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
  ): Promise<void> => {
    await step
      .do(stepName, publicationStep, async () => {
        let checkRunId = await services.ledger.checkRunId(run.id);
        const github = await services.createMutationContext();
        if (
          checkRunId === undefined &&
          github.publisher.findCheckRunByExternalId !== undefined
        ) {
          checkRunId = await github.publisher.findCheckRunByExternalId(run.id);
        }
        if (
          checkRunId !== undefined &&
          github.publisher.updateCheckRun !== undefined
        ) {
          await github.publisher.updateCheckRun({
            checkRunId,
            completedAt: now(),
            conclusion,
            output,
            status: "completed",
          });
        }
      })
      .catch((checkRunError: unknown) => {
        emit("check_run.update_failed", {
          errorKind: errorKind(checkRunError),
          stepName,
        });
      });
  };

  try {
    const claim = await step.do("claim-run", stateStep, async () => {
      const outcome = await services.ledger.claimRun(
        run,
        workflowInstanceId,
        causalVersionForJob(job),
      );
      emit("review.started", {
        eventTimestamp: rawEvent.timestamp.toISOString(),
      });
      return outcome;
    });
    if (claim === "duplicate") {
      return { findingsPublished: 0, outcome: "duplicate" } as const;
    }
    runClaimed = true;

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

    const initialHeadIsCurrent = await step.do(
      "revalidate-initial-head",
      publicationStep,
      async () =>
        (await services.ledger.isLatestRun(run.id)) &&
        (await services.readCurrentHead()) === job.envelope.pullRequest.headSha,
    );
    if (!initialHeadIsCurrent) {
      return await completeObsolete(
        "running",
        "mark-obsolete-before-preparation",
        false,
      );
    }

    repositoryStarted = true;
    await ensureCheckRunStarted();
    await step.do("prepare-repository", repositoryStep, async () => {
      await services.registerCredentialScope();
      const prepared = await services.prepareRepository(1);
      emit("repository.prepared", {
        changedLineCount: prepared.changedLineCount,
        contextBytes: prepared.contextBytes,
        fileCount: prepared.fileCount,
        truncated: prepared.truncated,
      });
    });

    type ReconciledReviewOutput = AggregatedReviewResult & {
      readonly activeFindings: readonly ReconciledFinding[];
      readonly resolvedFindings: readonly TrackedFinding[];
      readonly updatedTrackedFindings: readonly TrackedFinding[];
    };

    const output: ReconciledReviewOutput = await step.do(
      "analyze-review",
      modelStep,
      async () => {
        try {
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
            textualFileCount: context.files.filter(
              (file) => file.mode === "textual",
            ).length,
            truncated: context.truncated,
          });

          const diffFiles = context.files.map((file) => ({
            changeType: "modified" as const,
            newPath: file.path,
            oldPath: file.path,
            patch: file.patch,
            path: file.path,
          }));
          const plan = buildReviewPlan(diffFiles);

          if (plan.scopeStatus === "unsupported" || plan.shards.length === 0) {
            return {
              ...aggregateShardReviews(plan, []),
              activeFindings: [] as readonly ReconciledFinding[],
              resolvedFindings: [] as readonly TrackedFinding[],
              updatedTrackedFindings: [] as readonly TrackedFinding[],
            };
          }

          const shardResults: ShardReviewResult[] = [];
          for (const shard of plan.shards) {
            const shardContext = {
              changedLines: shard.changedLines,
              files: shard.files,
              schemaVersion: 2 as const,
              surface: shard.surface,
              truncated: shard.totalShards > 1,
            };
            if (plan.shards.length === 1) {
              const reviewResult = await services.model.review(
                job,
                shardContext,
              );
              const modelOutput = modelReviewOutputSchema.parse(
                reviewResult.output,
              );
              shardResults.push({
                findings: modelOutput.findings,
                shardId: shard.id,
                shardIndex: shard.index,
                status: "success",
                summary: modelOutput.summary,
              });
            } else {
              try {
                const reviewResult = await services.model.review(
                  job,
                  shardContext,
                );
                const modelOutput = modelReviewOutputSchema.parse(
                  reviewResult.output,
                );
                shardResults.push({
                  findings: modelOutput.findings,
                  shardId: shard.id,
                  shardIndex: shard.index,
                  status: "success",
                  summary: modelOutput.summary,
                });
              } catch (error) {
                const failureCode = nonRetryableModelFailureCode(error);
                const reason =
                  failureCode !== undefined
                    ? `model_${failureCode}`
                    : error instanceof Error
                      ? error.message
                      : "Unknown error";
                shardResults.push({
                  errorReason: reason,
                  findings: [],
                  shardId: shard.id,
                  shardIndex: shard.index,
                  status: "failure",
                  summary: "",
                });
              }
            }
          }

          if (
            shardResults.length > 0 &&
            shardResults.every((r) => r.status === "failure")
          ) {
            throw new Error("All review shards failed during model execution");
          }

          const rawAggregated = aggregateShardReviews(plan, shardResults);

          const currentWithFingerprints = await Promise.all(
            rawAggregated.findings.map(async (finding) => {
              const fingerprint = await computeStableFingerprint({
                diagnostic: finding.diagnostic,
                excerpt: finding.evidence[0]?.excerpt ?? "",
                path: finding.location.path,
              });
              return { ...finding, fingerprint };
            }),
          );

          const baseline = services.ledger.loadPrFindings
            ? await services.ledger.loadPrFindings(prKey)
            : [];

          const prFiles = plan.shards.flatMap((s) =>
            s.files.map((f) => f.path),
          );

          const reconciled = reconcileFindings({
            baselineFindings: baseline,
            currentFindings: currentWithFingerprints,
            currentHeadSha: job.envelope.pullRequest.headSha,
            currentRunId: run.id,
            prFiles,
            prKey,
          });

          const finalAggregated = aggregateShardReviews(
            plan,
            shardResults,
            undefined,
            undefined,
            reconciled.summary,
          );

          return {
            ...finalAggregated,
            activeFindings: reconciled.activeFindings,
            resolvedFindings: reconciled.resolvedFindings,
            updatedTrackedFindings: reconciled.updatedTrackedFindings,
          };
        } catch (error) {
          const failureCode = nonRetryableModelFailureCode(error);
          if (failureCode !== undefined) {
            throw new NonRetryableError(
              `HOLON_MODEL_NON_RETRYABLE:${failureCode}`,
            );
          }
          throw error;
        }
      },
    );

    await moveTo("begin-publication", "running", "publishing", false);
    const currentBeforePublication = await step.do(
      "revalidate-current-head",
      publicationStep,
      async () =>
        (await services.ledger.isLatestRun(run.id)) &&
        (await services.readCurrentHead()) === job.envelope.pullRequest.headSha,
    );
    if (!currentBeforePublication) {
      return await completeObsolete(
        "publishing",
        "mark-obsolete-and-schedule-cleanup",
        true,
      );
    }

    let findingsPublished = 0;
    const trackedToPersist = [...output.updatedTrackedFindings];

    for (const [index, finding] of output.activeFindings.entries()) {
      if (classifyFindingPublication(finding) !== "inline") continue;

      // Suppress duplicate inline comments for persistent findings
      if (
        finding.status === "persistent" &&
        finding.previousCommentId !== undefined
      ) {
        continue;
      }

      const result = await step.do(
        `publish-inline-${index + 1}`,
        publicationStep,
        async () => {
          const github = await services.createMutationContext();
          try {
            const findingId = await createFindingId(run.id, {
              diagnostic: finding.diagnostic,
              endLine: finding.location.line,
              path: finding.location.path,
              startLine: finding.location.startLine ?? finding.location.line,
            });
            let commentId: number | undefined;
            const published = await publishAuthorized(
              services.ledger,
              github.publisher,
              run.id,
              findingId,
              "inline",
              renderFinding(finding),
              {
                line: finding.location.line,
                path: finding.location.path,
                side: "RIGHT",
                ...(finding.location.startLine !== undefined
                  ? { startLine: finding.location.startLine }
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
        const trackedIndex = trackedToPersist.findIndex(
          (t) => t.fingerprint === finding.fingerprint,
        );
        const existing = trackedToPersist[trackedIndex];
        if (existing !== undefined) {
          trackedToPersist[trackedIndex] = {
            ...existing,
            githubCommentId: result.commentId,
          };
        }
      }
      if (result.published) findingsPublished += 1;
    }

    // Notify resolutions on original comment threads
    for (const [index, resolved] of output.resolvedFindings.entries()) {
      const commentId = resolved.githubCommentId;
      if (commentId === undefined) continue;
      await step.do(
        `notify-resolved-${index + 1}`,
        publicationStep,
        async () => {
          const github = await services.createMutationContext();
          if (github.publisher.replyToComment === undefined) return;
          try {
            const shortSha = job.envelope.pullRequest.headSha.slice(0, 7);
            await github.publisher.replyToComment(
              commentId,
              `✅ Defeito resolvido no commit \`${shortSha}\`.`,
            );
          } catch (error) {
            emit("finding.resolution_reply_failed", {
              commentId,
              errorKind: errorKind(error),
            });
          }
        },
      );
    }

    const summaryResult = await step.do(
      "publish-summary",
      publicationStep,
      async () => {
        const github = await services.createMutationContext();
        let summaryText = output.summary;
        if (services.ledger.loadCiEvidence) {
          try {
            const ciEvidence = await services.ledger.loadCiEvidence(
              prKey,
              job.envelope.pullRequest.headSha,
            );
            if (ciEvidence?.markdown) {
              summaryText = appendCiEvidenceToSummary(
                summaryText,
                ciEvidence.markdown,
              );
            }
          } catch (error) {
            emit("ci_evidence_load_failed", {
              errorKind: errorKind(error),
              prKey,
            });
          }
        }
        try {
          const published = await publishAuthorized(
            services.ledger,
            github.publisher,
            run.id,
            "summary",
            "summary",
            summaryText,
            { event: output.verdict },
            () => authorizeMutation(github, "review"),
          );
          return { authorized: true, published } as const;
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

    // Persist tracked findings in ledger
    await step.do("save-pr-findings", publicationStep, async () => {
      if (services.ledger.savePrFindings !== undefined) {
        await services.ledger.savePrFindings(prKey, trackedToPersist);
      }
    });

    const isPartial =
      output.scopeStatus === "partial_by_policy" ||
      output.scopeStatus === "partial_by_failure";
    const checkRunConclusion = determineCheckRunConclusion(
      output.findings,
      isPartial,
      output.verdict,
    );
    const checkRunOutput = formatCheckRunOutput({
      durationMs: durationFrom(rawEvent.timestamp, now()),
      findings: output.findings,
      partial: isPartial,
      reconciliation: output.reconciliation,
      scopeStatus: output.scopeStatus,
      shardsAnalyzed: output.shardsAnalyzed,
      summary: output.summary,
      totalShards: output.totalShards,
      verdict: output.verdict,
    });
    await updateCheckRunCompleted(
      "complete-check-run",
      checkRunConclusion,
      checkRunOutput,
    );

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
    if (runClaimed) {
      await updateCheckRunCompleted("fail-check-run", "failure", {
        summary:
          "Holon encountered a system failure and could not complete the automated review. Scheduled for cleanup.",
        title: "Holon Review Failed",
      });
    }
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
    });
    if (runClaimed && terminal?.changed === true) {
      await step
        .do("publish-failure-notice", publicationStep, async () => {
          const github = await services.createMutationContext();
          await publishFailureNoticeAuthorized(github.publisher, run.id, () =>
            authorizeMutation(github, "failure"),
          );
        })
        .catch((publicationError: unknown) => {
          emit("review.failure_notice_failed", {
            errorKind: errorKind(publicationError),
          });
        });
    }
    throw error;
  }
}
