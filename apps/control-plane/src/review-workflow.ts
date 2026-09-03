import {
  createReviewRun,
  determineCheckRunConclusion,
  formatCheckRunOutput,
  renderFinding,
} from "@holon/application";
import {
  reviewJobSchema,
  type CheckRunConclusion,
  type CheckRunOutput,
  type ReviewJob,
  type RunTelemetry,
  type StepTiming,
} from "@holon/contracts";
import {
  appendCiEvidenceToSummary,
  calculateInferenceCost,
  classifyFindingPublication,
  createFindingId,
  createPrKey,
  evaluateRunSlo,
  type RunState,
} from "@holon/domain";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";

import {
  isReviewMutationNotAuthorizedError,
  publishAuthorized,
  publishFailureNoticeAuthorized,
} from "./authorized-publication.js";
import { consoleLogger, errorKind } from "./observability.js";
import { analyzeReview } from "./review-analysis.js";
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

  const workflowStartedAt = now();
  const stepTimings: StepTiming[] = [];
  const recordStepTiming = (
    stepName: string,
    durationMs: number,
    status: "success" | "failure",
    attempt = 1,
  ) => {
    const timing: StepTiming = { attempt, durationMs, status, stepName };
    stepTimings.push(timing);
    try {
      void services.telemetry?.emitStepTiming(timing);
    } catch {
      // ignore
    }
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
    const prepStart = Date.now();
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
    recordStepTiming("prepare-repository", Date.now() - prepStart, "success");

    const analysisStart = Date.now();
    const output = await step.do(
      "analyze-review",
      modelStep,
      async () => await analyzeReview(job, services, emit),
    );
    recordStepTiming("analyze-review", Date.now() - analysisStart, "success");

    const pubStart = Date.now();
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
      await services.ledger.savePrFindings(prKey, trackedToPersist);
    });
    await step.do("record-review-decision", stateStep, async () => {
      await services.ledger.recordReviewDecision(run.id, {
        headSha: job.envelope.pullRequest.headSha,
        isDegraded: output.isDegraded === true,
        scopeStatus: output.scopeStatus,
        shardsAnalyzed: output.shardsAnalyzed,
        totalShards: output.totalShards,
      });
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
      structuralImpact: output.structuralImpact,
      summary: output.summary,
      totalShards: output.totalShards,
      verdict: output.verdict,
    });
    await updateCheckRunCompleted(
      "complete-check-run",
      checkRunConclusion,
      checkRunOutput,
    );

    recordStepTiming("publication", Date.now() - pubStart, "success");

    const finishedAt = now();
    const totalDurationMs = durationFrom(rawEvent.timestamp, finishedAt);
    const queueWaitMs = durationFrom(rawEvent.timestamp, workflowStartedAt);
    const usage = services.getAccumulatedUsage();
    const tokenAccounting = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.inputTokens + usage.outputTokens,
    };
    const cost = calculateInferenceCost("deepseek-chat", tokenAccounting);
    const runTelemetry: RunTelemetry = {
      cost,
      createdAt: finishedAt,
      durationMs: totalDurationMs,
      headSha: job.envelope.pullRequest.headSha,
      isDegraded: output.isDegraded === true,
      prKey,
      queueWaitMs,
      runId: run.id,
      scopeStatus: output.scopeStatus,
      shardsCount: output.totalShards,
      stepTimings,
      terminalState: "completed",
      tokens: tokenAccounting,
      toolCallsCount: usage.toolCallsCount,
      verdict: output.verdict,
    };

    const slo = evaluateRunSlo(runTelemetry);
    if (!slo.compliant) {
      emit("slo.breached", {
        runId: run.id,
        violations: slo.violations.join("; "),
      });
    }

    await services.ledger.saveRunTelemetry(runTelemetry).catch(() => {});
    void services.telemetry?.emitRunTelemetry(runTelemetry);

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

    const failedAt = now();
    const failedDurationMs = durationFrom(rawEvent.timestamp, failedAt);
    const queueWaitMs = durationFrom(rawEvent.timestamp, workflowStartedAt);
    const usage = services.getAccumulatedUsage();
    const tokenAccounting = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.inputTokens + usage.outputTokens,
    };
    const cost = calculateInferenceCost("unknown", tokenAccounting);
    const failedTelemetry: RunTelemetry = {
      cost,
      createdAt: failedAt,
      durationMs: failedDurationMs,
      headSha: job.envelope.pullRequest.headSha,
      isDegraded: true,
      prKey,
      queueWaitMs,
      runId: run.id,
      scopeStatus: "partial_by_failure",
      shardsCount: 1,
      stepTimings,
      terminalState: "failed_terminal",
      tokens: tokenAccounting,
      toolCallsCount: usage.toolCallsCount,
    };
    await services.ledger.saveRunTelemetry(failedTelemetry).catch(() => {});
    void services.telemetry?.emitRunTelemetry(failedTelemetry);

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
